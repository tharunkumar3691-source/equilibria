// Built-in demos with realistic people (lib/humans.ts). Each is ordinary scene code with real-world
// numbers, and reports what is happening through a live readout. Like the other demos, the logic is
// "stateless": it decides from the physics clock and the bodies, so replay and rewind stay correct.
import { SimulationData } from '../types';
import { stage } from './demoStage';

// Shared by the demos: easing and mixing of pose directions
const helpers = `
    const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
    const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
`;

export const SEESAW: SimulationData = {
  demoMode: true,
  title: 'Seesaw Balance',
  startMode: 'click',
  startHint: "Click anywhere to let go of the seesaw",
  thought_process: "ANALYSIS COMPLETE.\n\nScenario: A playground seesaw with two adult riders.\nVisuals: An 80 kg man sits 1.2 m from the pivot; a 55 kg woman sits on the end seat, 1.8 m out.\nInteraction: Click anywhere to let go of the level seesaw.\nPhysics Profile:\n- Torque: a weight turns the plank with torque τ = m·g·d, where d is its horizontal distance from the pivot (the lever arm).\n- His side: 80 × 9.81 × 1.2 = 942 N·m. Her side: 55 × 9.81 × 1.8 = 971 N·m. She is 25 kg lighter but wins, because she sits further out.\n- Law of the lever (Archimedes, about 250 BC): the plank balances when m₁·d₁ = m₂·d₂. Here she would need to weigh 53.3 kg.\n- The plank's own weight acts at the pivot, so it adds no torque either way.\n- The riders sit above the plank, so once it tilts the lower rider's lever arm grows and the higher one's shrinks. A perfectly balanced seesaw is an unstable equilibrium: any small difference makes it tip.\n\nTry it: set Her Mass to 53.5 kg and reset (R) to see it tip ever so slowly. Then try making him heavier.",
  code: stage('0x3f6b2a') + helpers + `
    world.gravity.set(0, -9.81, 0);
    world.allowSleep = false;  // Slow, nearly balanced motion must not be frozen by sleeping bodies
    world.solver.iterations = 40;
    camera.position.set(0.4, 2.0, 6.6);
    camera.userData.lookAt = [0, 0.85, 0];
    floorMesh.material.roughness = 1;   // Grass

    const PIVOT_Y = 0.6, HALF = 2.0, THICK = 0.08, WIDTH = 0.32;
    const D_HIM = 1.2, D_HER = 1.8;     // m from the pivot, along the plank
    const SEAT_TOP = THICK / 2 + 0.05;  // Seat pads stand 5 cm proud of the plank

    // Steel A-frame and axle
    const steel = new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.6, roughness: 0.35 });
    const tube = (a, b, r) => {
        const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, from.distanceTo(to), 16), steel);
        m.position.copy(from).add(to).multiplyScalar(0.5);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
        m.castShadow = true;
        scene.add(m);
    };
    [-0.28, 0.28].forEach(z => {
        tube([-0.45, 0, z], [0, PIVOT_Y, z], 0.035);
        tube([0.45, 0, z], [0, PIVOT_Y, z], 0.035);
    });
    tube([0, PIVOT_Y, -0.32], [0, PIVOT_Y, 0.32], 0.04);

    const pivot = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(0, PIVOT_Y, 0) });
    world.addBody(pivot);
    const plank = new CANNON.Body({ mass: 25, shape: new CANNON.Box(new CANNON.Vec3(HALF, THICK / 2, WIDTH / 2)), position: new CANNON.Vec3(0, PIVOT_Y + THICK / 2, 0) });
    plank.angularDamping = 0.05;  // A little friction in the bearing
    world.addConstraint(new CANNON.HingeConstraint(pivot, plank, {
        pivotA: new CANNON.Vec3(0, 0, 0), axisA: new CANNON.Vec3(0, 0, 1),
        pivotB: new CANNON.Vec3(0, -THICK / 2, 0), axisB: new CANNON.Vec3(0, 0, 1)
    }));

    // The plank with its seat pads and handles (they move with it)
    const plankMesh = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, THICK, WIDTH), new THREE.MeshStandardMaterial({ color: 0x9c6a3c, roughness: 0.7 }));
    board.castShadow = board.receiveShadow = true;
    plankMesh.add(board);
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.9 });
    const grip = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5 });
    [[-D_HIM, 1], [D_HER, -1]].forEach(([x, toward]) => {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, WIDTH + 0.02), rubber);
        seat.position.set(x, THICK / 2 + 0.025, 0);
        seat.castShadow = true;
        plankMesh.add(seat);
        // Handle 0.38 m in front of the seat, towards the pivot
        const hx = x + toward * 0.38;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 12), steel);
        post.position.set(hx, THICK / 2 + 0.15, 0);
        post.castShadow = true;
        plankMesh.add(post);
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 12), grip);
        bar.rotation.x = Math.PI / 2;
        bar.position.set(hx, THICK / 2 + 0.3, 0);
        bar.castShadow = true;
        plankMesh.add(bar);
    });
    addSimulationObject('Plank', plankMesh, plank, { sound: 'wood' });

    // Riders: point masses locked to the plank, their weight acting at their own centre of mass
    // (about 30 cm above the seat). They do not collide with anything.
    const rider = (label, kind, mass, height, x, facing) => {
        const body = new CANNON.Body({ mass, shape: new CANNON.Box(new CANNON.Vec3(0.17, 0.3, 0.17)), position: new CANNON.Vec3(x, PIVOT_Y + THICK / 2 + SEAT_TOP + 0.3, 0) });
        body.collisionFilterMask = 0;
        world.addBody(body);
        world.addConstraint(new CANNON.LockConstraint(plank, body));
        const human = addHuman(kind, {
            height,
            pose: h => {
                h.rest();
                // Sitting astride the plank, facing the pivot, hands on the handle
                h.aim('Spine', [0, 1, 0.1]);
                // How high the knees are decides whether the feet hang or rest on the ground
                const kneeHeight = body.position.y - 0.3;
                const shin = 0.27 * height;
                const reach = Math.min(1, Math.max(0, (kneeHeight - 0.04) / shin));
                ['Left', 'Right'].forEach(side => {
                    const s = side === 'Left' ? 1 : -1;
                    h.aim(side + 'UpLeg', [0.38 * s, -0.12, 0.92]);
                    h.aim(side + 'Leg', [0.08 * s, -reach, Math.sqrt(1 - reach * reach) + 0.1]);
                    h.aim(side + 'Foot', [0.05 * s, -0.35, 1]);
                    h.aim(side + 'Arm', [0.16 * s, -0.75, 0.62]);
                    h.aim(side + 'ForeArm', [-0.1 * s, 0.05, 1]);
                });
                // Hips on the seat pad: the figure's hips sit 0.3 m below the body's centre
                h.object.position.y = -0.3 + 0.07 - h.where('Hips').y;
            }
        });
        const turn = new THREE.Group();
        turn.rotation.y = facing;
        turn.add(human.object);
        const g = new THREE.Group();
        g.add(turn);
        addSimulationObject(label, g, body, { sound: 'soft' });
        return body;
    };
    const him = rider('Man', 'man', 80, 1.8, -D_HIM, Math.PI / 2);
    const her = rider('Woman', 'woman', 55, 1.66, D_HER, -Math.PI / 2);

    const report = () => {
        const g = Math.abs(world.gravity.y);
        const d1 = -him.position.x, d2 = her.position.x;   // Lever arms: horizontal distance from the pivot
        const t1 = him.mass * g * d1, t2 = her.mass * g * d2;
        const net = t2 - t1;
        const q = plank.quaternion;
        const tilt = Math.abs(2 * Math.atan2(q.z, q.w) * 180 / Math.PI);
        setReadout('Torque · the law of the lever', [
            ['His torque (' + him.mass.toFixed(0) + ' kg × ' + d1.toFixed(2) + ' m)', t1.toFixed(0) + ' N·m'],
            ['Her torque (' + her.mass.toFixed(1) + ' kg × ' + d2.toFixed(2) + ' m)', t2.toFixed(0) + ' N·m'],
            ['Net torque', Math.abs(net) < 3 ? 'balanced' : Math.abs(net).toFixed(0) + ' N·m, ' + (net > 0 ? 'her side down' : 'his side down')],
            ['Plank tilt', tilt.toFixed(1) + '°'],
            ['She would balance him at', (him.mass * D_HIM / D_HER).toFixed(1) + ' kg'],
            'Torque = weight × lever arm. Balance needs m₁·d₁ = m₂·d₂, so the heavier rider sits closer to the pivot.'
        ]);
    };
    report();
    addFrameCallback(report);
  `,
  sliders: [
    { label: "His Mass", targetLabel: "Man", property: "mass", min: 40, max: 140, value: 80, step: 1 },
    { label: "Her Mass", targetLabel: "Woman", property: "mass", min: 30, max: 120, value: 55, step: 0.5 }
  ]
};

export const CRATE_PUSH: SimulationData = {
  demoMode: true,
  title: 'Pushing a Crate',
  startMode: 'click',
  startHint: "Click anywhere and he starts to push",
  thought_process: "ANALYSIS COMPLETE.\n\nScenario: Pushing a heavy wooden crate across a concrete floor.\nVisuals: An 80 kg man and a 90 kg crate.\nInteraction: Click anywhere and he starts to push, harder every second (160 N more each second).\nPhysics Profile:\n- Normal force: the floor holds the crate up with N = m·g = 883 N.\n- Static friction: while the crate is still, friction matches his push exactly, up to a limit of μs·N = 0.6 × 883 = 530 N (wood on concrete).\n- Breakaway: once his push passes 530 N the crate starts to slide, and friction drops to μk·N = 0.4 × 883 = 353 N. That is why a heavy object lurches when it finally gives.\n- Newton's second law: while his push is more than friction, the net force accelerates the crate (a = F_net ÷ m).\n- Newton's first law: at walking pace he pushes with exactly 353 N. The net force is zero, so the crate keeps a steady 1 m/s.\n- His limit: rubber soles grip concrete with about 0.8 × his weight (630 N). A crate heavier than about 107 kg needs more than that to break free, so he cannot move it however hard he tries.\n- At the end he lets go, and kinetic friction stops the crate in about a quarter of a second.\n\nTry it: raise Crate Mass above 107 kg. Then lower Gravity: his grip and the crate's friction fall together, so the limit stays the same.",
  code: stage('0x57534e') + helpers + `
    world.gravity.set(0, -9.81, 0);
    world.allowSleep = false;  // Slow, nearly balanced motion must not be frozen by sleeping bodies
    world.solver.iterations = 20;
    camera.position.set(-0.4, 2.6, 11.5);
    camera.userData.lookAt = [-0.4, 1.4, 0];
    floorMesh.material.roughness = 0.92;   // Concrete
    const t0 = world.time;

    const MU_S = 0.6, MU_K = 0.4;   // Wood on concrete: static and kinetic friction coefficients
    const SHOE_GRIP = 0.8;          // Rubber soles on concrete: he cannot push harder than 0.8 × his weight
    const MAN_MASS = 80;
    const RAMP = 160;               // N per second: he leans in harder and harder
    const CRUISE = 1.0;             // m/s, the walking pace he keeps once it moves
    const X0 = -3.5, X_END = 4;
    const HALF = [0.55, 0.6, 0.5];   // A 1.1 × 1.2 × 1.0 m crate: he pushes at chest height

    // Painted aisle lines
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    [-1.3, 1.3].forEach(z => {
        const line = new THREE.Mesh(new THREE.PlaneGeometry(30, 0.1), lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(0, 0.002, z);
        line.receiveShadow = true;
        scene.add(line);
    });

    // A wooden crate: boards with darker battens along every edge
    const crateMat = new CANNON.Material();
    // Friction is applied below, so the solver's own friction is off for the crate
    world.addContactMaterial(new CANNON.ContactMaterial(crateMat, floorMat, { friction: 0, restitution: 0 }));
    const crate = new CANNON.Body({ mass: 90, material: crateMat, shape: new CANNON.Box(new CANNON.Vec3(...HALF)), position: new CANNON.Vec3(X0, HALF[1], 0) });
    crate.fixedRotation = true;
    crate.updateMassProperties();
    crate.linearFactor.set(1, 1, 0);
    const crateMesh = new THREE.Group();
    const boards = new THREE.Mesh(new THREE.BoxGeometry(HALF[0] * 2, HALF[1] * 2, HALF[2] * 2), new THREE.MeshStandardMaterial({ color: 0xb08350, roughness: 0.82 }));
    boards.castShadow = boards.receiveShadow = true;
    crateMesh.add(boards);
    const batten = new THREE.MeshStandardMaterial({ color: 0x7a5530, roughness: 0.85 });
    const E = 0.07;
    [-1, 1].forEach(a => [-1, 1].forEach(b => {
        const edges = [
            [[HALF[0] * 2 + 0.02, E, E], [0, a * (HALF[1] - E / 2 + 0.01), b * (HALF[2] - E / 2 + 0.01)]],
            [[E, HALF[1] * 2 + 0.02, E], [a * (HALF[0] - E / 2 + 0.01), 0, b * (HALF[2] - E / 2 + 0.01)]],
            [[E, E, HALF[2] * 2 + 0.02], [a * (HALF[0] - E / 2 + 0.01), b * (HALF[1] - E / 2 + 0.01), 0]]
        ];
        edges.forEach(([size, pos]) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(...size), batten);
            m.position.set(...pos);
            m.castShadow = true;
            crateMesh.add(m);
        });
    }));
    [-1, 1].forEach(side => {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(HALF[0] * 2 - 0.1, HALF[1] * 2 - 0.1), E, 0.03), batten);
        brace.rotation.z = Math.atan2(HALF[1] * 2 - 0.1, HALF[0] * 2 - 0.1);
        brace.position.set(0, 0, side * (HALF[2] + 0.01));
        crateMesh.add(brace);
    });
    addSimulationObject('Crate', crateMesh, crate, { sound: 'wood', main: true });

    // Everything about the push, worked out from the clock and the crate's motion
    const state = () => {
        const g = Math.abs(world.gravity.y);
        const t = world.time - t0, v = crate.velocity.x, m = crate.mass;
        const N = m * g;
        const maxPush = SHOE_GRIP * MAN_MASS * g;
        const effort = Math.min(RAMP * t, maxPush);
        const moving = v > 0.002;
        if (crate.position.x > X_END) {
            return { t, v, N, push: 0, friction: moving ? MU_K * N : 0, phase: moving ? 'stopping' : 'stopped' };
        }
        if (!moving && effort <= MU_S * N) {
            // Static friction: exactly as much as the push, so nothing moves
            return { t, v, N, push: effort, friction: effort, phase: effort >= maxPush - 1e-6 && t > 0 ? 'stuck' : 'static' };
        }
        // Sliding: he eases off towards a steady walking pace, where his push just matches friction
        const push = Math.min(effort, Math.max(0, MU_K * N + m * (CRUISE - v) / 0.8));
        return { t, v, N, push, friction: MU_K * N, phase: v < CRUISE * 0.97 ? 'accelerating' : 'steady' };
    };

    world.addEventListener('preStep', () => {
        const s = state();
        if (s.phase === 'static' || s.phase === 'stuck' || s.phase === 'stopped') { crate.velocity.x = 0; return; }
        // Kinetic friction cannot push the crate backwards: it stops it
        if (s.phase === 'stopping' && crate.velocity.x < MU_K * Math.abs(world.gravity.y) / 60) { crate.velocity.x = 0; return; }
        crate.applyForce(new CANNON.Vec3(s.push - s.friction, 0, 0), crate.position);
    });

    const man = addHuman('man', {
        height: 1.8,
        pose: h => {
            const s = state();
            const pushingNow = s.phase !== 'stopping' && s.phase !== 'stopped';
            if (pushingNow) {
                // Feet keep pace with the floor: the walk cycle advances with the distance covered
                h.play('Walk', (crate.position.x - X0) / 1.3 * 1.033);
                // The harder he pushes, the further he leans into it
                const lean = 0.2 + 0.4 * Math.min(1, s.push / 600);
                h.aim('Spine', [0, 1, lean]);
                h.aim('Spine1', [0, 1, lean * 0.6]);
                ['Left', 'Right'].forEach(side => {
                    const x = side === 'Left' ? 1 : -1;
                    h.aim(side + 'Arm', [0.2 * x, -0.7, 0.7]);
                    h.aim(side + 'ForeArm', [0.04 * x, -0.3, 1]);
                    h.aim(side + 'Hand', [0, 0.8, 0.6]);   // Palms flat on the crate
                });
            } else {
                h.play('Idle', s.t);
            }
            // Stand so the palms rest on the crate's back face (he lets go at the end and stays put)
            const face = Math.min(crate.position.x, X_END) - HALF[0];
            const reach = pushingNow ? (h.where('LeftHand').z + h.where('RightHand').z) / 2 + 0.03 : 0.45;
            h.object.position.x = face - reach;
        }
    });
    man.object.rotation.y = Math.PI / 2;

    const NOTES = {
        static: 'Static friction grows to match his push exactly, so nothing moves until the push passes μs·N.',
        stuck: 'Too heavy: his shoes would slip before the push reaches μs·N. He can push about 0.8 × his weight at most.',
        accelerating: 'It broke free. Sliding friction μk·N is less than the grip it had, so the extra push accelerates it: a = F_net ÷ m.',
        steady: "Push equals friction: zero net force, so the crate keeps a constant speed (Newton's first law).",
        stopping: 'He let go. Kinetic friction alone now slows the crate: a = −μk·g.',
        stopped: 'At rest with no push, there is no friction at all.'
    };
    const report = () => {
        const s = state();
        const isStatic = s.phase === 'static' || s.phase === 'stuck' || s.phase === 'stopped';
        setReadout('Friction · static and kinetic', [
            ['His push', s.push.toFixed(0) + ' N'],
            ['Friction on the crate', s.friction.toFixed(0) + ' N' + (s.friction > 0 ? (isStatic ? ' (static)' : ' (kinetic)') : '')],
            ['Net force', (s.push - s.friction).toFixed(0) + ' N'],
            ['Crate speed', Math.max(0, s.v).toFixed(2) + ' m/s'],
            ['Breakaway  μs·N', (MU_S * s.N).toFixed(0) + ' N'],
            ['Sliding  μk·N', (MU_K * s.N).toFixed(0) + ' N'],
            NOTES[s.phase]
        ]);
    };
    report();
    addFrameCallback(report);
  `,
  sliders: [
    { label: "Crate Mass", targetLabel: "Crate", property: "mass", min: 20, max: 200, value: 90, step: 1 },
    { label: "Gravity", targetLabel: "world", property: "gravity", min: 1.6, max: 25, value: 9.81, step: 0.01 }
  ]
};
