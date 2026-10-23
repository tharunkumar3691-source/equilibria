import { Layers, CircleDot, Target, Orbit, Waves, RefreshCw, Blocks, Scale, Package, Disc3, TreePine, Hourglass, LucideIcon } from 'lucide-react';
import { SimulationData } from '../types';
import { SOLAR_SYSTEM } from './solarSystem';
import { BLACK_HOLE } from './blackHole';
import { TREE_HEIGHT } from './trigDemos';
import { TIME_DILATION } from './relativityDemos';
import { stage } from './demoStage';
import { PENDULUM_WAVE, LOOP_THE_LOOP, BLOCK_TOWER } from './moreDemos';
import { SEESAW, CRATE_PUSH } from './humanDemos';

export interface DemoScenario {
  id: string;
  title: string;
  tagline: string;
  accent: string; // Hex colour used for the card / button highlight
  icon: LucideIcon;
  data: SimulationData;
}

const DOMINO_SPIRAL: SimulationData = {
  demoMode: true,
  startMode: 'auto', // Has its own trigger: the user topples a domino by clicking it
  thought_process: "ANALYSIS COMPLETE.\n\nScenario: Chain Reaction (Rainbow Domino Spiral).\nVisuals: 100 colour-graded dominoes standing on an inward spiral.\nInteraction: Click any domino to topple it. Nothing falls until you touch one.\nPhysics Profile:\n- Mechanism: Sequential toppling (rigid box contacts).\n- Energy: Gravitational potential released link by link.\n- Wave speed: Set by spacing, height and gravity.\n\nWaiting for your touch...",
  code: stage('0x1a2426') + `
    world.gravity.set(0, -25, 0);
    world.solver.iterations = 20;
    camera.position.set(0, 34, 30);

    const dominoMat = new CANNON.Material();
    world.addContactMaterial(new CANNON.ContactMaterial(floorMat, dominoMat, { friction: 0.5, restitution: 0.05 }));
    // Domino-to-domino contact must stay frictionless or the chain jams into a leaning pile
    world.addContactMaterial(new CANNON.ContactMaterial(dominoMat, dominoMat, { friction: 0, restitution: 0.05 }));

    const T = 0.35, H = 2.4, W = 1.2;
    const count = 100;
    const spacing = 1.25;
    const dominoes = [];
    const tangents = [];
    const dominoShape = new CANNON.Box(new CANNON.Vec3(T / 2, H / 2, W / 2));
    const dominoGeo = new THREE.BoxGeometry(T, H, W);

    // Walk an inward spiral at constant arc-length spacing
    const pts = [];
    const theta0 = Math.PI * 0.8; // Start on the near-left side, clear of the settings panel
    let theta = theta0;
    for (let i = 0; i <= count; i++) {
        const r = 13.5 - 0.62 * (theta - theta0);
        pts.push([r * Math.cos(theta), r * Math.sin(theta)]);
        theta += spacing / r;
    }

    for (let i = 0; i < count; i++) {
        const tx = pts[i + 1][0] - pts[i][0];
        const tz = pts[i + 1][1] - pts[i][1];
        const tLen = Math.hypot(tx, tz);

        const body = new CANNON.Body({
            mass: 1,
            material: dominoMat,
            shape: dominoShape,
            position: new CANNON.Vec3(pts[i][0], H / 2 + 0.02, pts[i][1]),
            linearDamping: 0,
            angularDamping: 0,
            sleepSpeedLimit: 0.15,
            sleepTimeLimit: 1
        });
        // Thin axis (local X) follows the spiral tangent
        body.quaternion.setFromEuler(0, Math.atan2(-tz, tx), 0);

        const mesh = new THREE.Mesh(dominoGeo, new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(i / count, 0.85, 0.55),
            roughness: 0.35
        }));
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        addSimulationObject('domino_' + i, mesh, body, { sound: 'wood' });
        dominoes.push(body);
        tangents.push([tx / tLen, tz / tLen]);
        body.sleep(); // Nothing moves until the user touches a domino
    }

    // "Touch here" marker floating above the first domino
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 4), new THREE.MeshBasicMaterial({ color: 0xfde047 }));
    marker.rotation.x = Math.PI; // Point down
    marker.position.set(pts[0][0], H + 1.6, pts[0][1]);
    scene.add(marker);

    const upright = (b) => 1 - 2 * (b.quaternion.x * b.quaternion.x + b.quaternion.z * b.quaternion.z);
    const isAsleep = (b) => b.sleepState === CANNON.Body.SLEEPING;

    // Tip one domino forward along the spiral with a push at its top edge
    const topple = (i) => {
        const b = dominoes[i];
        const push = 1.2 * b.mass;
        b.wakeUp();
        for (let k = -2; k <= 2; k++) { if (dominoes[i + k]) dominoes[i + k].wakeUp(); }
        b.applyImpulse(new CANNON.Vec3(tangents[i][0] * push, 0, tangents[i][1] * push), new CANNON.Vec3(0, H / 2, 0));
    };

    // Touch to topple: clicking a standing domino tips it over (and keeps the inspector closed)
    addClickCallback((label) => {
        if (!label.startsWith('domino_')) return false;
        const i = Number(label.slice(7));
        if (upright(dominoes[i]) > 0.97) topple(i);
        return true;
    });

    // A sleeping body acts as immovable, so wake the neighbours of any domino that starts to tip.
    // Runs after every physics step (not every rendered frame) so it also works at low frame rates.
    let started = false;
    world.addEventListener('postStep', () => {
        if (!dominoes[0].world) return; // Scene was rebuilt; this listener is stale
        for (let i = 0; i < count; i++) {
            const b = dominoes[i];
            if (upright(b) < 0.9) started = true;
            if (isAsleep(b) || upright(b) > 0.985) continue;
            for (let k = -2; k <= 2; k++) {
                const n = dominoes[i + k];
                if (n && n !== b && isAsleep(n) && upright(n) > 0.9) n.wakeUp();
            }
        }
    });

    let frame = 0;
    addFrameCallback(() => {
        marker.visible = !started;
        marker.position.y = H + 1.6 + Math.sin(frame++ * 0.08) * 0.35;
        marker.rotation.y += 0.03;
    });
  `,
  sliders: [
    { label: "Domino Mass", targetLabel: "domino", property: "mass", min: 0.2, max: 10, value: 1, step: 0.2 },
    { label: "Gravity", targetLabel: "world", property: "gravity", min: 0, max: 50, value: 25, step: 1 },
    { label: "Time Scale", targetLabel: "world", property: "scale", min: 0.1, max: 2.0, value: 1.0, step: 0.1 },
    { label: "Bounciness", targetLabel: "world", property: "restitution", min: 0, max: 1, value: 0.05, step: 0.05 }
  ]
};

const NEWTONS_CRADLE: SimulationData = {
  demoMode: true,
  startMode: 'click',
  startHint: "Click anywhere to release the first ball",
  thought_process: "ANALYSIS COMPLETE.\n\nScenario: Momentum Transfer (Newton's Cradle).\nVisuals: Five suspended spheres on a rigid frame, one held at height.\nInteraction: Click anywhere on the scene to release the raised ball.\nPhysics Profile:\n- Mechanism: Pendulum constraints (PointToPoint).\n- Collisions: Near-elastic (restitution ~0.98).\n- Conservation: Momentum and kinetic energy pass through the row.\n\nWaiting for your click...",
  code: stage('0x1b2426') + `
    world.gravity.set(0, -30, 0);
    world.solver.iterations = 40;
    world.allowSleep = false;
    camera.position.set(14, 14, 30);

    const ballMat = new CANNON.Material();
    world.addContactMaterial(new CANNON.ContactMaterial(ballMat, ballMat, { friction: 0.0, restitution: 0.98 }));

    const N = 5, R = 1.1, L = 9, topY = 13, gap = 0.02, D = 3;
    const span = (N - 1) / 2 * (2 * R + gap);

    // Frame (visual only)
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.4, roughness: 0.3 });
    [-D, D].forEach(z => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 5, 0.35, 0.35), frameMat);
        rail.position.set(0, topY, z);
        rail.castShadow = true;
        scene.add(rail);
        [-1, 1].forEach(side => {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, topY, 0.35), frameMat);
            leg.position.set(side * (span + 2.5), topY / 2, z);
            leg.castShadow = true;
            scene.add(leg);
        });
    });

    // One static anchor body holds every pendulum pivot
    const anchor = new CANNON.Body({ mass: 0 });
    anchor.position.set(0, topY, 0);
    world.addBody(anchor);

    const balls = [];
    const xs = [];
    for (let i = 0; i < N; i++) {
        const x = (i - (N - 1) / 2) * (2 * R + gap);
        const lift = i === 0 ? Math.PI / 3.2 : 0; // First ball is pulled back

        const body = new CANNON.Body({
            mass: 5,
            material: ballMat,
            shape: new CANNON.Sphere(R),
            position: new CANNON.Vec3(x - Math.sin(lift) * L, topY - Math.cos(lift) * L, 0),
            linearDamping: 0,
            angularDamping: 0
        });
        body.quaternion.setFromEuler(0, 0, -lift);
        // Keep the swing in the X-Y plane
        body.linearFactor.set(1, 1, 0);
        body.angularFactor.set(0, 0, 1);

        const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 48), new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(0.52 + i * 0.08, 0.8, 0.6),
            metalness: 0.35,
            roughness: 0.15
        }));
        mesh.castShadow = true;

        addSimulationObject('cradle_' + i, mesh, body, { sound: 'metal', main: i === 0 });
        world.addConstraint(new CANNON.PointToPointConstraint(anchor, new CANNON.Vec3(x, 0, 0), body, new CANNON.Vec3(0, L, 0)));

        balls.push(body);
        xs.push(x);
    }

    // Strings: two per ball, redrawn every frame
    const linePos = new Float32Array(N * 2 * 6);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    const strings = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xe2e8f0 }));
    strings.frustumCulled = false;
    scene.add(strings);

    const updateStrings = () => {
        balls.forEach((b, i) => {
            for (let s = 0; s < 2; s++) {
                const o = (i * 2 + s) * 6;
                linePos[o] = xs[i];
                linePos[o + 1] = topY;
                linePos[o + 2] = s === 0 ? -D : D;
                linePos[o + 3] = b.position.x;
                linePos[o + 4] = b.position.y;
                linePos[o + 5] = b.position.z;
            }
        });
        lineGeo.attributes.position.needsUpdate = true;
    };
    updateStrings();
    addFrameCallback(updateStrings);
  `,
  sliders: [
    { label: "Ball Mass", targetLabel: "cradle", property: "mass", min: 1, max: 30, value: 5, step: 1 },
    { label: "Air Drag", targetLabel: "cradle", property: "damping", min: 0, max: 0.5, value: 0, step: 0.01 },
    { label: "Gravity", targetLabel: "world", property: "gravity", min: 0, max: 60, value: 30, step: 1 },
    { label: "Time Scale", targetLabel: "world", property: "scale", min: 0.1, max: 2.0, value: 1.0, step: 0.1 },
    { label: "Bounciness", targetLabel: "world", property: "restitution", min: 0, max: 1, value: 0.98, step: 0.02 }
  ]
};

const BOWLING_STRIKE: SimulationData = {
  demoMode: true,
  startMode: 'click',
  startHint: "Click anywhere to bowl the ball",
  thought_process: "ANALYSIS COMPLETE.\n\nScenario: High-Speed Impact (Ten-Pin Bowling Strike).\nVisuals: Neon-lit lane, ball waiting at the foul line, ten pins in a triangle rack.\nInteraction: Click anywhere on the scene to bowl the ball.\nPhysics Profile:\n- Projectile: Heavy rolling sphere (~14kg) with matched spin.\n- Targets: Light, tall rigid bodies that tip and scatter.\n- Mechanism: Momentum transfer plus pin-to-pin collisions.\n\nWaiting for your click...",
  code: stage('0x161f22') + `
    world.gravity.set(0, -20, 0);
    world.solver.iterations = 30;
    camera.position.set(-20, 13, 20);

    const ballMat = new CANNON.Material();
    const pinMat = new CANNON.Material();
    world.addContactMaterial(new CANNON.ContactMaterial(floorMat, ballMat, { friction: 0.3, restitution: 0.1 }));
    world.addContactMaterial(new CANNON.ContactMaterial(floorMat, pinMat, { friction: 0.4, restitution: 0.2 }));
    world.addContactMaterial(new CANNON.ContactMaterial(ballMat, pinMat, { friction: 0.2, restitution: 0.4 }));
    world.addContactMaterial(new CANNON.ContactMaterial(pinMat, pinMat, { friction: 0.3, restitution: 0.3 }));

    // Lane (visual only, sits just above the floor)
    const lane = new THREE.Mesh(new THREE.BoxGeometry(36, 0.04, 6.4), new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.25 }));
    lane.position.set(-1, 0.02, 0);
    lane.receiveShadow = true;
    scene.add(lane);

    // Side rails: real barriers, taller than the ball's centre so it cannot ride over them.
    // Smoked glass with a neon top edge, so the lane stays visible from the side.
    const RAIL_H = 1.3;
    const RAIL_START = -19, RAIL_END = 4.5; // The rails stop before the pin deck so struck pins can scatter sideways
    const RAIL_LEN = RAIL_END - RAIL_START, RAIL_MID = (RAIL_START + RAIL_END) / 2;
    const railGlass = new THREE.MeshStandardMaterial({ color: 0x334155, transparent: true, opacity: 0.35, roughness: 0.1 });
    [[-3.45, 0x22d3ee], [3.45, 0xe879f9]].forEach(([z, color]) => {
        const railBody = new CANNON.Body({ mass: 0, material: floorMat, shape: new CANNON.Box(new CANNON.Vec3(RAIL_LEN / 2, RAIL_H / 2, 0.12)) });
        railBody.position.set(RAIL_MID, RAIL_H / 2, z);
        world.addBody(railBody);

        const rail = new THREE.Mesh(new THREE.BoxGeometry(RAIL_LEN, RAIL_H, 0.24), railGlass);
        rail.position.set(RAIL_MID, RAIL_H / 2, z);
        scene.add(rail);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(RAIL_LEN, 0.12, 0.3), new THREE.MeshBasicMaterial({ color }));
        strip.position.set(RAIL_MID, RAIL_H + 0.06, z);
        scene.add(strip);
    });

    // Padded backstop behind the pins: stops the ball at the end of the lane instead of letting it roll off
    const STOP_H = 3.2;
    const stopBody = new CANNON.Body({ mass: 0, material: floorMat, shape: new CANNON.Box(new CANNON.Vec3(0.4, STOP_H / 2, 3.57)) });
    stopBody.position.set(16.6, STOP_H / 2, 0);
    world.addBody(stopBody);
    const stop = new THREE.Mesh(new THREE.BoxGeometry(0.8, STOP_H, 7.14), new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 }));
    stop.position.set(16.6, STOP_H / 2, 0);
    stop.castShadow = true;
    scene.add(stop);
    const stopGlow = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.12, 7.2), new THREE.MeshBasicMaterial({ color: 0xfde047 }));
    stopGlow.position.set(16.6, STOP_H + 0.06, 0);
    scene.add(stopGlow);

    // Pins: lathe-turned visual, stable box collider
    const PIN_H = 2.4;
    const RACK = 0.85; // Pin triangle spacing. Tightened so falling pins reliably take their neighbours down
    const profile = [[0, -1.2], [0.3, -1.2], [0.42, -0.7], [0.45, -0.3], [0.36, 0.15], [0.2, 0.5], [0.18, 0.65], [0.26, 0.9], [0.24, 1.08], [0.12, 1.19], [0, 1.2]];
    const pinGeo = new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p[0], p[1])), 24);
    const bandGeo = new THREE.CylinderGeometry(0.2, 0.215, 0.16, 24);
    const pinShape = new CANNON.Box(new CANNON.Vec3(0.3, PIN_H / 2, 0.3));

    for (let row = 0; row < 4; row++) {
        for (let j = 0; j <= row; j++) {
            const x = 6 + row * 1.35 * RACK;
            const z = (j - row / 2) * 1.55 * RACK;

            const pin = new THREE.Group();
            const bodyMesh = new THREE.Mesh(pinGeo, new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25 }));
            bodyMesh.castShadow = true;
            const band = new THREE.Mesh(bandGeo, new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3 }));
            band.position.y = 0.56;
            pin.add(bodyMesh);
            pin.add(band);

            const body = new CANNON.Body({
                mass: 1.2,
                material: pinMat,
                shape: pinShape,
                position: new CANNON.Vec3(x, PIN_H / 2 + 0.05, z),
                linearDamping: 0.1,
                angularDamping: 0.1
            });
            addSimulationObject('pin_' + row + '_' + j, pin, body, { sound: 'wood' });
        }
    }

    // Ball: rolling without slipping, slightly off-centre for a pocket hit
    const BALL_R = 1.1, SPEED = 24; // 24 gives a strike at every lane offset and frame rate tested
    const ball = new THREE.Group();
    const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 48, 48), new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.15, metalness: 0.2, emissive: 0x2e1065 }));
    ballMesh.castShadow = true;
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(BALL_R * 0.99, 0.07, 12, 48), new THREE.MeshBasicMaterial({ color: 0xfde047 }));
    stripe.rotation.y = Math.PI / 2;
    ball.add(ballMesh);
    ball.add(stripe);

    const ballBody = new CANNON.Body({
        mass: 14,
        material: ballMat,
        shape: new CANNON.Sphere(BALL_R),
        position: new CANNON.Vec3(-12, BALL_R + 0.05, 0.3), // In clear view while it waits for the start click
        linearDamping: 0.02,
        angularDamping: 0.02
    });
    ballBody.velocity.set(SPEED, 0, 0);
    ballBody.angularVelocity.set(0, 0, -SPEED / BALL_R);
    addSimulationObject('BowlingBall', ball, ballBody, { sound: 'plastic', main: true });
  `,
  sliders: [
    { label: "Ball Mass", targetLabel: "BowlingBall", property: "mass", min: 1, max: 60, value: 14, step: 1 },
    { label: "Pin Mass", targetLabel: "pin", property: "mass", min: 0.2, max: 10, value: 1.2, step: 0.2 },
    { label: "Gravity", targetLabel: "world", property: "gravity", min: 0, max: 40, value: 20, step: 1 },
    { label: "Time Scale", targetLabel: "world", property: "scale", min: 0.1, max: 2.0, value: 1.0, step: 0.1 },
    { label: "Bounciness", targetLabel: "world", property: "restitution", min: 0, max: 1, value: 0.3, step: 0.05 },
    { label: "Friction", targetLabel: "world", property: "friction", min: 0, max: 1, value: 0.3, step: 0.05 }
  ]
};

// Where each demo really happens, shown in Realistic mode. 'realSize' is the real size (m) of the set-up's
// largest dimension, which scales the room and furniture around it (the demos use their own units).
const at = (data: SimulationData, environment: SimulationData['environment']): SimulationData => ({ ...data, environment });

// In display order; the first is also the one the app falls back to
export const DEMOS: DemoScenario[] = [
  // Accents: one soft, low-saturation family (aqua, lavender, periwinkle, apricot, sage, sand, rose...)
  { id: 'newtons-cradle', title: "Newton's Cradle", tagline: 'Momentum passing through five spheres', accent: '#86c8d6', icon: CircleDot, data: at(NEWTONS_CRADLE, { setting: 'study', realSize: 0.24 }) },
  { id: 'domino-spiral', title: 'Domino Spiral', tagline: 'Touch a domino to set off the chain reaction', accent: '#b6a8de', icon: Layers, data: at(DOMINO_SPIRAL, { setting: 'living-room', realSize: 1.2 }) },
  { id: 'solar-system', title: 'Solar System', tagline: 'All eight planets orbiting the Sun under real gravity', accent: '#94b4e0', icon: Orbit, data: at(SOLAR_SYSTEM, { setting: 'space' }) },
  // These two are their own setting already: a sunny field with one tree, and the depths of space
  { id: 'tree-height', title: 'Tree Height', tagline: 'Trigonometry: measure a tree by its shadow, h = L tan θ', accent: '#9fcfa9', icon: TreePine, data: at(TREE_HEIGHT, { setting: 'none' }) },
  { id: 'black-hole', title: 'Black Hole', tagline: 'Gravity so strong that not even light escapes', accent: '#e2ae84', icon: Disc3, data: at(BLACK_HOLE, { setting: 'none' }) },
  { id: 'time-dilation', title: 'Time Dilation', tagline: 'The twin paradox: light clocks on a trip to Proxima Centauri', accent: '#a9bfe6', icon: Hourglass, data: at(TIME_DILATION, { setting: 'space' }) },
  { id: 'seesaw', title: 'Seesaw Balance', tagline: 'A lighter rider further out beats a heavier one', accent: '#a3cba6', icon: Scale, data: at(SEESAW, { setting: 'park', upm: 1 }) },
  { id: 'crate-push', title: 'Pushing a Crate', tagline: 'Static friction, breakaway and a steady push', accent: '#d8bd8a', icon: Package, data: at(CRATE_PUSH, { setting: 'warehouse', upm: 1 }) },
  { id: 'bowling-strike', title: 'Bowling Strike', tagline: 'A neon lane, ten pins and one heavy ball', accent: '#e0a8a4', icon: Target, data: at(BOWLING_STRIKE, { setting: 'bowling-alley', upm: 4.5 }) },
  { id: 'pendulum-wave', title: 'Pendulum Wave', tagline: 'Twelve pendulums drift in and out of step', accent: '#86c9b8', icon: Waves, data: at(PENDULUM_WAVE, { setting: 'lab', realSize: 0.9 }) },
  { id: 'loop-the-loop', title: 'Loop the Loop', tagline: 'A ball rolls down a ramp and around a full loop', accent: '#d6aac8', icon: RefreshCw, data: at(LOOP_THE_LOOP, { setting: 'living-room', realSize: 1.1 }) },
  { id: 'block-tower', title: 'Block Tower', tagline: 'Click a block to push it out and see what holds', accent: '#e3b9a3', icon: Blocks, data: at(BLOCK_TOWER, { setting: 'study', realSize: 0.3 }) }
];
