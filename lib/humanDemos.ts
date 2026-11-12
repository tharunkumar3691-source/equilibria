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
  code: stage('0x4d6146') + helpers + `
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
    const steel = new THREE.MeshStandardMaterial({ color: 0x4f7a8c, metalness: 0.6, roughness: 0.35 });
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
