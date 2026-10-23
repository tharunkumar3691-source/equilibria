// Second set of built-in demos. Each is ordinary scene code, run exactly like an AI-generated scene.
// Scene logic here is written to be "stateless" (it decides from positions and the physics clock,
// not from remembered flags), so the timeline can rewind and replay these scenes correctly.
import { SimulationData } from '../types';
import { stage } from './demoStage';

export const PENDULUM_WAVE: SimulationData = {
  demoMode: true,
  title: 'Pendulum Wave',
  startMode: 'click',
  startHint: "Click anywhere to release the pendulums",
  thought_process: "ANALYSIS COMPLETE.\n\nScenario: Pendulum Wave.\nVisuals: Twelve pendulums of carefully stepped lengths on one beam.\nInteraction: Click anywhere on the scene to release them together.\nPhysics Profile:\n- Period: Each pendulum completes one more swing per minute than its neighbour (15 to 26 swings).\n- Pattern: They drift out of step into travelling waves and return to a straight line after 60 seconds.\n- Law: Period depends only on length and gravity, T = 2π√(L/g).\n\nWaiting for your click...",
  code: stage('0x172022') + `
    world.gravity.set(0, -20, 0);
    world.solver.iterations = 40;
    world.allowSleep = false;
    camera.position.set(15, 12, 27);

    const N = 12, G = 20, CYCLE = 60, BASE = 15;
    const topY = 14, R = 0.5, DZ = 1.3, LIFT = 0.3;
    const depth = (N - 1) * DZ;

    // Beam and legs (visual only)
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.5, roughness: 0.35 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, depth + 3), frameMat);
    beam.position.set(0, topY, 0);
    beam.castShadow = true;
    scene.add(beam);
    [-1, 1].forEach(end => {
        [-1, 1].forEach(side => {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, topY + 0.6, 0.3), frameMat);
            leg.position.set(side * 3.2, topY / 2, end * (depth / 2 + 1.5));
            leg.rotation.z = side * 0.225;
            leg.castShadow = true;
            scene.add(leg);
        });
    });

    const bobs = [];
    const zs = [];
    for (let i = 0; i < N; i++) {
        // Pendulum i makes (BASE + i) full swings in CYCLE seconds
        const T = CYCLE / (BASE + i);
        // A real pendulum swings slightly slower at a wide angle than the small-angle formula says
        // (by a factor of about 1 + angle²/16), so the length allows for the release angle
        const L = G * Math.pow(T / (1 + LIFT * LIFT / 16) / (2 * Math.PI), 2);
        const z = (i - (N - 1) / 2) * DZ;

        const body = new CANNON.Body({
            mass: 1,
            shape: new CANNON.Sphere(R),
            position: new CANNON.Vec3(-Math.sin(LIFT) * L, topY - Math.cos(LIFT) * L, z),
            linearDamping: 0,
            angularDamping: 0
        });
        // Each pendulum swings in its own vertical plane. The bob does not turn, so it behaves as the
        // ideal point mass the period formula assumes (a turning ball would swing slightly slower).
        body.linearFactor.set(1, 1, 0);
        body.angularFactor.set(0, 0, 0);

        const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 32), new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(0.48 + i * 0.035, 0.85, 0.58),
            metalness: 0.3,
            roughness: 0.2
        }));
        mesh.castShadow = true;

        addSimulationObject('bob_' + i, mesh, body, { sound: 'plastic' });
        // A rigid string: the bob stays exactly L from its own fixed point on the beam
        const anchor = new CANNON.Body({ mass: 0 });
        anchor.position.set(0, topY, z);
        world.addBody(anchor);
        world.addConstraint(new CANNON.DistanceConstraint(anchor, body, L));
        bobs.push(body);
        zs.push(z);
    }

    // Strings, redrawn every frame
    const linePos = new Float32Array(N * 6);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    const strings = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xe2e8f0 }));
    strings.frustumCulled = false;
    scene.add(strings);
    const updateStrings = () => {
        bobs.forEach((b, i) => {
            const o = i * 6;
            linePos[o] = 0; linePos[o + 1] = topY; linePos[o + 2] = zs[i];
            linePos[o + 3] = b.position.x; linePos[o + 4] = b.position.y; linePos[o + 5] = b.position.z;
        });
        lineGeo.attributes.position.needsUpdate = true;
    };
    updateStrings();
    addFrameCallback(updateStrings);
  `,
  sliders: [
    { label: "Gravity", targetLabel: "world", property: "gravity", min: 2, max: 40, value: 20, step: 1 },
    { label: "Air Drag", targetLabel: "bob", property: "damping", min: 0, max: 0.3, value: 0, step: 0.01 }
  ]
};

export const LOOP_THE_LOOP: SimulationData = {
  demoMode: true,
  title: 'Loop the Loop',
  startMode: 'click',
  startHint: "Click anywhere to release the ball",
  thought_process: "ANALYSIS COMPLETE.\n\nScenario: Loop the Loop.\nVisuals: A curved ramp feeding a vertical loop, then a run-out into a stack of crates.\nInteraction: Click anywhere on the scene to release the ball at the top of the ramp.\nPhysics Profile:\n- Energy: Height on the ramp becomes speed (potential to kinetic, part of it as spin).\n- Loop condition: At the top the ball must still be fast enough that the track pushes on it; a rolling ball needs a start about 2.7 loop-radii high.\n- Try it: lower Gravity changes nothing about whether it makes the loop; more Friction does.\n\nWaiting for your click...",
  code: stage('0x1a2426') + `
    world.gravity.set(0, -10, 0);
    world.solver.iterations = 30;
    camera.position.set(-3, 13, 31);

    const ballMat = new CANNON.Material();
    const trackMat = new CANNON.Material();
    const crateMat = new CANNON.Material();
    const wallMat = new CANNON.Material();
    world.addContactMaterial(new CANNON.ContactMaterial(ballMat, trackMat, { friction: 0.25, restitution: 0 }));
    // The side walls only steer: no grip, so they do not rob the ball of speed
    world.addContactMaterial(new CANNON.ContactMaterial(ballMat, wallMat, { friction: 0, restitution: 0 }));
    world.addContactMaterial(new CANNON.ContactMaterial(ballMat, floorMat, { friction: 0.3, restitution: 0.1 }));
    world.addContactMaterial(new CANNON.ContactMaterial(ballMat, crateMat, { friction: 0.2, restitution: 0.2 }));
    world.addContactMaterial(new CANNON.ContactMaterial(crateMat, crateMat, { friction: 0.4, restitution: 0.1 }));
    world.addContactMaterial(new CANNON.ContactMaterial(crateMat, floorMat, { friction: 0.5, restitution: 0.1 }));
    world.addContactMaterial(new CANNON.ContactMaterial(crateMat, trackMat, { friction: 0.4, restitution: 0.1 }));

    // Track: a channel (deck plus two low walls) built from short straight pieces
    const DECK_T = 0.3, TRACK_W = 2.0, WALL_H = 0.8, WALL_T = 0.2;
    const Y0 = 0.3;                     // Height of the level sections
    const RAMP_R = 13, RAMP_X = -7;     // Ramp: a circular arc that ends level at x = RAMP_X
    const LOOP_R = 3.4, LOOP_X = -2.5;  // Loop: bottom at x = LOOP_X
    const Z_IN = -1.5, Z_SHIFT = 3;     // The loop is a slight helix, so the way out runs beside the way in
    const END_X = 7;                    // The run-out ends here; the crates stand on the open floor beyond

    const deckVis = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4, metalness: 0.1 });
    const wallVis = new THREE.MeshStandardMaterial({ color: 0xfed7aa, roughness: 0.4, transparent: true, opacity: 0.55 });
    const qz = new CANNON.Quaternion(), qy = new CANNON.Quaternion();
    const zAxis = new CANNON.Vec3(0, 0, 1), yAxis = new CANNON.Vec3(0, 1, 0);

    const slab = (x, y, z, sx, sy, sz, quat, material, physMat) => {
        const body = new CANNON.Body({ mass: 0, material: physMat || trackMat, shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)) });
        body.position.set(x, y, z);
        body.quaternion.copy(quat);
        world.addBody(body);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
        mesh.position.set(x, y, z);
        mesh.quaternion.set(quat.x, quat.y, quat.z, quat.w);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
    };

    // One channel piece whose running surface passes through (x, y, z), tilted by 'angle' about z
    // and turned by 'yaw' about its own surface normal
    const piece = (x, y, z, angle, len, yaw) => {
        qz.setFromAxisAngle(zAxis, angle);
        qy.setFromAxisAngle(yAxis, -yaw);
        const q = qz.mult(qy);
        const nx = -Math.sin(angle), ny = Math.cos(angle);
        slab(x - nx * DECK_T / 2, y - ny * DECK_T / 2, z, len, DECK_T, TRACK_W + 2 * WALL_T, q, deckVis);
        [-1, 1].forEach(side => {
            const off = side * (TRACK_W / 2 + WALL_T / 2);
            // The wall's sideways offset follows the piece's yaw
            const wx = x + nx * WALL_H / 2 - Math.sin(yaw) * Math.cos(angle) * off;
            const wy = y + ny * WALL_H / 2 - Math.sin(yaw) * Math.sin(angle) * off;
            slab(wx, wy, z + Math.cos(yaw) * off, len, WALL_H, WALL_T, q, wallVis, wallMat);
        });
    };

    // Ramp (angle psi measured up the arc from its lowest point)
    const RAMP_TOP = 1.45, RAMP_N = 30;
    for (let i = 0; i < RAMP_N; i++) {
        const psi = (i + 0.5) / RAMP_N * RAMP_TOP;
        const len = 2 * (RAMP_R + DECK_T) * Math.tan(RAMP_TOP / RAMP_N / 2) + 0.03;
        piece(RAMP_X - RAMP_R * Math.sin(psi), Y0 + RAMP_R * (1 - Math.cos(psi)), Z_IN, -psi, len, 0);
    }

    // Level run in, loop, level run out
    piece((RAMP_X + LOOP_X) / 2, Y0, Z_IN, 0, LOOP_X - RAMP_X + 0.05, 0);
    const LOOP_N = 72, LOOP_Y = Y0 + LOOP_R;
    for (let i = 0; i < LOOP_N; i++) {
        const phi = (i + 0.5) / LOOP_N * Math.PI * 2;
        const len = 2 * (LOOP_R + DECK_T) * Math.tan(Math.PI / LOOP_N) + 0.03;
        // The sideways shift eases in and out (none at the bottom, most at the top), so the ball is
        // steered gradually instead of being knocked sideways as it enters
        const shift = (phi - Math.sin(phi)) / (2 * Math.PI);
        const yaw = Math.atan(Z_SHIFT * (1 - Math.cos(phi)) / (2 * Math.PI * LOOP_R));
        piece(LOOP_X + LOOP_R * Math.sin(phi), LOOP_Y - LOOP_R * Math.cos(phi), Z_IN + Z_SHIFT * shift, phi, len, yaw);
    }
    const Z_OUT = Z_IN + Z_SHIFT;
    piece((LOOP_X + END_X) / 2, Y0, Z_OUT, 0, END_X - LOOP_X + 0.05, 0);

    // A pyramid of crates across the ball's path, on the open floor (in a walled channel they would jam)
    const crateGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    const crateShape = new CANNON.Box(new CANNON.Vec3(0.45, 0.45, 0.45));
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3 - row; col++) {
            const body = new CANNON.Body({
                mass: 0.25,
                material: crateMat,
                shape: crateShape,
                position: new CANNON.Vec3(11, 0.46 + row * 0.905, Z_OUT + (col - (2 - row) / 2) * 0.95),
                linearDamping: 0.1,
                angularDamping: 0.1
            });
            const mesh = new THREE.Mesh(crateGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.09 + row * 0.03, 0.6, 0.5), roughness: 0.7 }));
            mesh.castShadow = true;
            addSimulationObject('crate_' + row + '_' + col, mesh, body, { sound: 'wood' });
        }
    }

    // Ball, resting high on the ramp
    const BALL_R = 0.7, START = 1.37;
    const ball = new THREE.Group();
    const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 40, 40), new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.2, metalness: 0.3 }));
    ballMesh.castShadow = true;
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(BALL_R * 0.99, 0.05, 10, 40), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ball.add(ballMesh);
    ball.add(stripe);
    const ballBody = new CANNON.Body({
        mass: 5,
        material: ballMat,
        shape: new CANNON.Sphere(BALL_R),
        position: new CANNON.Vec3(
            RAMP_X - RAMP_R * Math.sin(START) + Math.sin(START) * (BALL_R + 0.02),
            Y0 + RAMP_R * (1 - Math.cos(START)) + Math.cos(START) * (BALL_R + 0.02),
            Z_IN),
        linearDamping: 0,
        angularDamping: 0
    });
    addSimulationObject('Ball', ball, ballBody, { sound: 'plastic', main: true });
  `,
  sliders: [
    { label: "Ball Mass", targetLabel: "Ball", property: "mass", min: 1, max: 30, value: 5, step: 1 },
    { label: "Crate Mass", targetLabel: "crate", property: "mass", min: 0.05, max: 3, value: 0.25, step: 0.05 },
    { label: "Gravity", targetLabel: "world", property: "gravity", min: 4, max: 20, value: 10, step: 1 },
    { label: "Friction", targetLabel: "world", property: "friction", min: 0, max: 1, value: 0.25, step: 0.05 }
  ]
};

export const BLOCK_TOWER: SimulationData = {
  demoMode: true,
  title: 'Block Tower',
  startMode: 'auto',
  thought_process: "ANALYSIS COMPLETE.\n\nScenario: Stacking Tower (Block Removal).\nVisuals: Fourteen layers of three wooden blocks, each layer turned a quarter turn.\nInteraction: Click any block to push it out of the tower. Drag blocks to move them by hand.\nPhysics Profile:\n- Balance: The tower stands while the weight above each layer stays over its support.\n- Friction: Blocks above resist being slid out; lower blocks carry more weight.\n- Failure: Remove enough support on one side and the centre of mass tips past the edge.\n\nWaiting for your touch...",
  code: stage('0x1d2729') + `
    world.gravity.set(0, -20, 0);
    world.solver.iterations = 50;
    camera.position.set(13, 11, 19);

    const woodMat = new CANNON.Material();
    world.addContactMaterial(new CANNON.ContactMaterial(woodMat, woodMat, { friction: 0.45, restitution: 0 }));
    world.addContactMaterial(new CANNON.ContactMaterial(woodMat, floorMat, { friction: 0.6, restitution: 0.02 }));

    const L = 3, H = 0.6, W = 1, LAYERS = 14;
    const blockGeo = new THREE.BoxGeometry(L, H, W);
    const blockShape = new CANNON.Box(new CANNON.Vec3(L / 2, H / 2, W / 2));
    const blocks = {};

    for (let k = 0; k < LAYERS; k++) {
        const turned = k % 2 === 1;
        for (let j = -1; j <= 1; j++) {
            const body = new CANNON.Body({
                mass: 1,
                material: woodMat,
                shape: blockShape,
                position: new CANNON.Vec3(turned ? j * W : 0, H / 2 + 0.001 + k * H, turned ? 0 : j * W),
                linearDamping: 0.2,
                angularDamping: 0.2,
                sleepSpeedLimit: 0.3,
                sleepTimeLimit: 0.3
            });
            if (turned) body.quaternion.setFromEuler(0, Math.PI / 2, 0);
            body.sleep(); // Perfectly still until something touches it
            const mesh = new THREE.Mesh(blockGeo, new THREE.MeshStandardMaterial({
                color: new THREE.Color().setHSL(0.07 + ((k * 3 + j + 1) % 5) * 0.012, 0.55, 0.52 + ((k + j) % 2) * 0.06),
                roughness: 0.75
            }));
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const label = 'block_' + k + '_' + (j + 1);
            addSimulationObject(label, mesh, body, { sound: 'wood' });
            blocks[label] = body;
        }
    }

    // Click a block to slide it out along its length, away from the viewer.
    // The push is a steady shove for a moment (like a finger), not a single knock.
    const PUSH_SPEED = 6, PUSH_TIME = 0.6;
    let push = null;
    const axis = new CANNON.Vec3();
    addClickCallback((label) => {
        const body = blocks[label];
        if (!body) return false;
        body.quaternion.vmult(new CANNON.Vec3(1, 0, 0), axis);
        const away = (body.position.x - camera.position.x) * axis.x + (body.position.z - camera.position.z) * axis.z;
        const sign = away >= 0 ? 1 : -1;
        push = { body, x: axis.x * sign, z: axis.z * sign, until: world.time + PUSH_TIME };
        Object.keys(blocks).forEach(key => blocks[key].wakeUp());
        return true;
    });
    world.addEventListener('preStep', () => {
        if (!push) return;
        if (!push.body.world || world.time > push.until) { push = null; return; }
        push.body.wakeUp();
        push.body.velocity.x = push.x * PUSH_SPEED;
        push.body.velocity.z = push.z * PUSH_SPEED;
    });
  `,
  sliders: [
    { label: "Block Mass", targetLabel: "block", property: "mass", min: 0.2, max: 8, value: 1, step: 0.2 },
    { label: "Gravity", targetLabel: "world", property: "gravity", min: 2, max: 40, value: 20, step: 1 },
    { label: "Friction", targetLabel: "world", property: "friction", min: 0, max: 1, value: 0.45, step: 0.05 }
  ]
};
