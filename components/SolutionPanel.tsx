import React, { useMemo, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { ShieldCheck, ShieldAlert, ShieldQuestionMark, CircleCheck, CircleAlert, CircleDashed, ChevronDown, X, Sigma, ListChecks } from 'lucide-react';
import { ProblemAnswer, ProblemSolution } from '../types';

// LaTeX, typeset by KaTeX (which escapes its input, so model text cannot inject markup)
const TeX: React.FC<{ tex: string; display?: boolean }> = ({ tex, display = false }) => {
  const html = useMemo(() => katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html' }), [tex, display]);
  return <span className={display ? 'block overflow-x-auto overflow-y-hidden py-1' : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
};

// Plain text with inline maths between $...$
const RichText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(\$[^$]+\$)/g).map((part, i) =>
      part.length > 2 && part.startsWith('$') && part.endsWith('$')
        ? <TeX key={i} tex={part.slice(1, -1)} />
        : <React.Fragment key={i}>{part}</React.Fragment>
    )}
  </>
);

const VERDICTS: Record<ProblemSolution['verdict'], { label: string; detail: string; icon: React.ReactNode; tone: string }> = {
  verified: {
    label: 'Verified by simulation',
    detail: 'Every answer was measured in the simulation and agrees with the worked solution.',
    icon: <ShieldCheck className="w-4 h-4" />, tone: 'text-emerald-300 bg-emerald-400/10 border-emerald-300/25'
  },
  partial: {
    label: 'Partly verified',
    detail: 'The answers the simulation could measure agree. The others are worked out only.',
    icon: <ShieldCheck className="w-4 h-4" />, tone: 'text-amber-200 bg-amber-400/10 border-amber-300/25'
  },
  mismatch: {
    label: 'Simulation disagrees',
    detail: 'The simulation measured a different value for at least one answer. Check that step with care.',
    icon: <ShieldAlert className="w-4 h-4" />, tone: 'text-red-200 bg-red-400/10 border-red-300/25'
  },
  unchecked: {
    label: 'Not checked by simulation',
    detail: 'The simulation could not measure these answers, so they are worked out only.',
    icon: <ShieldQuestionMark className="w-4 h-4" />, tone: 'text-slate-300 bg-slate-700/30 border-white/10'
  }
};

const sig = (n: number) => {
  if (n === 0) return '0';
  const abs = Math.abs(n);
  return abs >= 1e5 || abs < 1e-3 ? n.toExponential(3) : String(Number(n.toPrecision(4)));
};

const AnswerRow: React.FC<{ answer: ProblemAnswer }> = ({ answer }) => {
  const measured = answer.measured !== undefined;
  const difference = measured && answer.value !== null && Math.abs(answer.value) > 1e-9
    ? Math.abs(answer.measured! - answer.value) / Math.abs(answer.value) * 100
    : null;
  const icon = answer.status === 'verified'
    ? <CircleCheck className="w-4 h-4 text-emerald-300" />
    : answer.status === 'mismatch' ? <CircleAlert className="w-4 h-4 text-red-300" /> : <CircleDashed className="w-4 h-4 text-slate-500" />;
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-slate-400">{answer.name}</div>
          <div className="text-[15px] text-slate-50 font-medium">
            {answer.symbol && <><TeX tex={answer.symbol} /> = </>}{answer.display}
          </div>
          <div className={`mt-0.5 text-[11px] leading-snug ${answer.status === 'verified' ? 'text-emerald-300/90' : answer.status === 'mismatch' ? 'text-red-200' : 'text-slate-500'}`}>
            {measured
              ? <>Simulation measured {sig(answer.measured!)} {answer.unit}{difference !== null && <> · {difference < 0.05 ? 'same value' : `${difference.toFixed(1)}% apart`}</>}{answer.status === 'mismatch' && ' · disagrees'}</>
              : answer.measurable ? (answer.reason || 'The simulation could not measure it.') : `Not measured: ${answer.reason || 'the simulation cannot measure this directly.'}`}
          </div>
        </div>
      </div>
    </li>
  );
};

interface SolutionPanelProps {
  problem: ProblemSolution;
  onClose: () => void;
}

export const SolutionPanel: React.FC<SolutionPanelProps> = ({ problem, onClose }) => {
  const [showStatement, setShowStatement] = useState(false);
  const verdict = VERDICTS[problem.verdict];

  return (
    <aside className="h-full flex flex-col glass rounded-3xl overflow-hidden" aria-label="Worked solution">
      <div className="shrink-0 flex items-center gap-2 px-4 pt-3.5 pb-3 border-b border-white/[0.06]">
        <Sigma className="w-4 h-4 text-blue-300" />
        <span className="font-display text-[17px] text-slate-50">Solution</span>
        {problem.topic && <span className="ml-1 truncate text-[11px] text-slate-500">{problem.topic}</span>}
        <button onClick={onClose} className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5" aria-label="Hide the solution" title="Hide the solution">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 text-[13px] leading-relaxed">
        {/* The problem as it was read */}
        <section>
          <button onClick={() => setShowStatement(s => !s)} className="w-full flex items-center justify-between text-[12px] font-medium text-slate-400 hover:text-slate-200" aria-expanded={showStatement}>
            Problem
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showStatement ? 'rotate-180' : ''}`} />
          </button>
          <p className={`mt-1.5 text-slate-300 whitespace-pre-line ${showStatement ? '' : 'line-clamp-3'}`}><RichText text={problem.statement} /></p>
          {problem.givens.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {problem.givens.map((g, i) => (
                <span key={i} title={g.name} className="px-2 py-0.5 rounded-md bg-slate-800/60 border border-white/[0.06] text-[12px] text-slate-200">
                  {g.symbol ? <><TeX tex={g.symbol} /> = </> : null}{g.value}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* The answers, each with what the simulation measured */}
        <section className="rounded-2xl border border-white/[0.07] bg-slate-950/30 p-3.5">
          <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-[12px] font-medium ${verdict.tone}`}>
            {verdict.icon} {verdict.label}
          </div>
          <p className="mt-2 mb-3 text-[11px] leading-snug text-slate-500">{verdict.detail}</p>
          <ul className="divide-y divide-white/[0.05]">
            {problem.answers.map(a => <AnswerRow key={a.id} answer={a} />)}
          </ul>
          {problem.note && (
            <p className="mt-3 pt-3 border-t border-white/[0.05] text-[12px] leading-snug text-slate-400">
              <span className="text-slate-300 font-medium">What was corrected: </span>{problem.note}
            </p>
          )}
        </section>

        {/* The worked solution */}
        <section>
          <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-slate-400 mb-2.5"><ListChecks className="w-3.5 h-3.5" /> Step by step</h3>
          <ol className="space-y-4">
            {problem.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-blue-400/15 text-blue-200 text-[11px] font-medium flex items-center justify-center tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-slate-100 font-medium">{step.title}</div>
                  {step.text && <p className="mt-0.5 text-slate-300"><RichText text={step.text} /></p>}
                  {step.equation && <div className="mt-1.5 text-slate-100"><TeX tex={step.equation} display /></div>}
                </div>
              </li>
            ))}
          </ol>
          {problem.summary && <p className="mt-4 p-3 rounded-xl bg-blue-400/[0.07] border border-blue-300/15 text-slate-200"><RichText text={problem.summary} /></p>}
        </section>

        {problem.assumptions.length > 0 && (
          <section>
            <h3 className="text-[12px] font-medium text-slate-400 mb-1.5">Assumptions</h3>
            <ul className="space-y-1 text-[12px] text-slate-400 list-disc pl-4 marker:text-slate-600">
              {problem.assumptions.map((a, i) => <li key={i}><RichText text={a} /></li>)}
            </ul>
          </section>
        )}

        <p className="text-[11px] leading-snug text-slate-500 border-t border-white/[0.05] pt-3">
          How this was checked: the simulation was built from the problem alone, without seeing this solution. It was then run
          at 600 steps a second to measure each answer, and the two were compared (they agree when within 2%).
        </p>
      </div>
    </aside>
  );
};
