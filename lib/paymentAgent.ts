// Payment tools for the Gemini assistant (lib/sceneEdit.ts). The assistant can check the balance, prepare a
// PayPal order for the right pack (for the user, or for the student pool), and take a student's share of the
// pool. It never completes a payment: a prepared order opens PayPal's own window, and nothing is charged until
// the user approves it there. Every tool goes through Equilibria's server (server/api.ts), which talks to PayPal.
import { FunctionDeclaration, Type } from '@google/genai';
import { Balance, claimFromPool, createPayPalOrder, CreditError, loadCredits, PreparedOrder } from './credits';

// The app listens for these: a new balance to show, and a prepared order to open in the credits dialog
export const BALANCE_EVENT = 'equilibria:balance';
export const CHECKOUT_EVENT = 'equilibria:checkout';
const announce = (name: string, detail: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

export const PAYMENT_TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_credit_balance',
    description: "Returns the user's credits, the credit packs for sale (with prices), the student pool, and whether PayPal is available. Call it before advising on credits or choosing a pack.",
  },
  {
    name: 'start_paypal_checkout',
    description: "Creates a PayPal (sandbox) order for a credit pack and opens PayPal's checkout window for the user to approve. Call it only when the user wants to buy credits or sponsor students. Nothing is charged until the user approves in PayPal.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        pack: { type: Type.STRING, enum: ['starter', 'class'], description: "'starter' (10 credits) for one person; 'class' (50 credits) for a group, a class, or many scenes." },
        purpose: { type: Type.STRING, enum: ['self', 'pool'], description: "'self' adds the credits to the user's balance; 'pool' gives them to the pay-it-forward pool for students who cannot pay." },
        reason: { type: Type.STRING, description: 'One short sentence on why this pack fits what the user said.' },
      },
      required: ['pack', 'purpose'],
    },
  },
  {
    name: 'claim_student_pool',
    description: "Gives a user who has no credits left today's small share of the student pool (credits that sponsors paid for). Only when the user has 0 credits and cannot or does not want to pay.",
  },
];
export const PAYMENT_TOOL_NAMES = PAYMENT_TOOLS.map(t => t.name as string);

export const PAYMENT_INSTRUCTION = `
CREDITS AND PAYMENTS (you can act on these with tools, whether or not a scene is open):
- Each new scene, video or solved problem made in the Create panel costs 1 credit; demos, the library and chat edits are free.
  A scene that never passes its physics check gives its credit back by itself ("verified or free").
- Credits are bought with PayPal (sandbox: test money only). Packs and prices come from get_credit_balance; never invent them.
- When the user is out of credits, asks about credits, wants to buy, mentions a class, a study group or students, or wants
  to help others: call get_credit_balance first, then act. Choose the pack from what they said: one person, a few scenes:
  'starter'; a group, a class, or many scenes: 'class'.
- To buy, call start_paypal_checkout. It opens PayPal's window; tell the user to approve it there. Never say a payment is
  complete: only PayPal's window completes it, and the app shows the new balance when it does.
- "Pay it forward" / "sponsor students" / "help someone who can't afford it": start_paypal_checkout with purpose 'pool'.
- A user with 0 credits who cannot pay: if the student pool has credits, offer claim_student_pool (and call it if they agree).
- Never call a payment tool for a question about physics or about the scene.
- The chat shows plain text: never use Markdown (no **bold**, no # headings).
`;

const balanceOf = (s: Balance): Balance => ({ credits: s.credits, purchased: s.purchased, sponsored: s.sponsored, assistant: s.assistant, pool: s.pool });

// Runs one payment tool and returns what the model is told about it
export async function runPaymentTool(name: string, args: Record<string, any>): Promise<Record<string, unknown>> {
  try {
    if (name === 'get_credit_balance') {
      const status = await loadCredits();
      announce(BALANCE_EVENT, balanceOf(status));
      return {
        credits: status.credits,
        packs: status.packs.map(p => ({ id: p.id, credits: p.credits, priceUsd: p.price, label: p.label })),
        studentPool: { credits: status.pool.credits, creditsYouCanTakeToday: status.credits === 0 ? Math.min(status.pool.claimable, status.pool.credits) : 0 },
        paypalAvailable: !!status.paypal,
        freeAssistantRequestsLeftToday: Math.max(0, status.assistant.limit - status.assistant.used),
      };
    }
    if (name === 'start_paypal_checkout') {
      const pack = args.pack === 'class' ? 'class' : 'starter';
      const purpose = args.purpose === 'pool' ? 'pool' : 'self';
      const order: PreparedOrder = await createPayPalOrder(pack, purpose);
      announce(CHECKOUT_EVENT, order);
      return {
        status: "PayPal order created. PayPal's checkout window is now open for the user to approve; nothing is charged until they do.",
        orderId: order.id,
        credits: order.credits,
        priceUsd: order.price,
        goesTo: purpose === 'pool' ? 'the student pool' : "the user's balance",
      };
    }
    if (name === 'claim_student_pool') {
      const result = await claimFromPool();
      announce(BALANCE_EVENT, balanceOf(result));
      return { claimed: result.claimed, creditsNow: result.credits };
    }
    return { error: `Unknown tool ${name}` };
  } catch (error) {
    if (error instanceof CreditError && error.balance) announce(BALANCE_EVENT, error.balance);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
