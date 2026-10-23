import { SimulationData } from '../types';

// Trigonometry demo: the height of a tree from the length of its shadow.
// The sun is a real light: the shadows are drawn by the renderer, and the right triangle (tree, shadow,
// sun's ray) is drawn over the scene as in a textbook figure. The tree is a pine, so its shadow tip is
// exactly the shadow of its apex and the geometry is exact. Two sliders drive it through fixed bodies
// (the same pattern as the black hole's mass): the sun's elevation in degrees and the tree's height in metres.
export const TREE_HEIGHT: SimulationData = {
  demoMode: true,
  startMode: 'auto',
  thought_process: "Scenario: Measuring the height of a tree you cannot climb, using only its shadow and a little trigonometry.\n\nThe idea:\nThe sun is so far away that its rays arrive parallel. The tree (vertical), its shadow (flat ground) and the sun's ray that just grazes the treetop form a right triangle. The angle θ between the ground and that ray is the sun's elevation.\n\nMethod 1: the tangent rule:\n- tan θ = opposite / adjacent = h / L, so h = L × tan θ.\n- Example: L = 11.92 m and θ = 40°: h = 11.92 × 0.839 = 10.0 m.\n- θ can be found from the time of day and your latitude, or measured with a clinometer pointed at the sun's direction (never at the sun itself).\n\nMethod 2: similar triangles (no trigonometry at all):\n- A 1 m stick, or a friend of known height, casts its own shadow s at the same moment.\n- The rays are parallel, so the two triangles have the same angles: h / L = 1 m / s, so h = L ÷ s.\n- This is how Thales measured the Great Pyramid around 600 BC.\n\nTricks with special angles:\n- θ = 45°: tan 45° = 1, so the tree is exactly as tall as its shadow. Wait for the moment your own shadow equals your height, then pace out the tree's shadow.\n- θ = 30°: h = L ÷ √3 ≈ 0.577 L.\n- θ = 60°: h = L × √3 ≈ 1.732 L.\n\nWhen there is no shadow (a cloudy day):\n- Stand a distance d from the trunk and measure the angle of elevation α to the top: h = d × tan α + your eye height.\n- If you cannot reach the trunk, measure the angles α and β from two points a distance d apart along a line to the tree: h = d ÷ (cot α − cot β).\n\nHow accurate is it? (error analysis):\n- An error δθ in the angle changes the height by δh / h = δθ ÷ (sin θ cos θ) = 2δθ ÷ sin 2θ.\n- That is smallest at θ = 45°: a 1° error there costs about 3.5%, but at 75° it costs about 7%. Near sunrise and sunset the shadow is also long and blurred.\n- Best practice: measure in mid-morning or mid-afternoon, when θ is between 30° and 60°.\n\nTry it: move the sun's elevation and the tree's height in the settings. The shadows, the triangle and every number update together. Set the sun to exactly 45° and compare the shadow with the tree.",
  code: `
    world.gravity.set(0, -9.81, 0);
    const ground = addGround('grass');
    // A brighter, sunlit lawn, so the shadows (the subject here) stand out clearly against it
    ground.mesh.material.color.setRGB(1.9, 1.9, 1.7);
    // From the side and about 25° above the ground: the triangle reads clearly and the shadow lies visibly on the grass
    camera.position.set(-1, 12, 22);
    camera.userData.lookAt = [-0.5, 3, 0];

    // Softer fill from the sky and a stronger sun, so the shadows read clearly on the dark grass
    scene.children.forEach(o => {
        if (o.isAmbientLight) o.intensity = 0.15;
        if (o.isHemisphereLight) o.intensity = 0.18;
    });
    const sun = scene.children.find(o => o.isDirectionalLight && o.castShadow) || null;
    if (sun) { sun.color.set(0xfff0d8); sun.intensity = 3.4; }

    // The sun is up to the right (clear of the panels in the view's top corners), so the shadow falls to
    // the left, along -x
    const TREE_X = 6;
    const STICK_X = 2.5, STICK_Z = -3.5;
    const DEG = Math.PI / 180;
    const noRaycast = () => {};
    const Y = new THREE.Vector3(0, 1, 0);

    // ---------- The controls: fixed bodies whose 'mass' the sliders set ----------
    const sunBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, shape: new CANNON.Sphere(0.1) });
    sunBody.collisionFilterGroup = 0; sunBody.collisionFilterMask = 0;
    sunBody.mass = 40;            // Sun's elevation, degrees
    addSimulationObject('Sun', new THREE.Group(), sunBody, { sound: 'soft' });

    const treeBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, shape: new CANNON.Sphere(0.1) });
    treeBody.collisionFilterGroup = 0; treeBody.collisionFilterMask = 0;
    treeBody.position.set(TREE_X, 0, 0);
    treeBody.mass = 10;           // Tree's height, metres

    // ---------- A pine, built at unit height (apex exactly at y = 1) and scaled to the tree's height ----------
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.045, 0.9, 16), realMaterial('dark-wood', { size: 0.3 }));
    trunk.position.y = 0.45;
    trunk.castShadow = true;
    tree.add(trunk);
    const greens = [0x2b4f35, 0x2f5639, 0x2d533a, 0x31593c, 0x2e553b, 0x335c3e, 0x36603f];
    for (let i = 0; i < 7; i++) {
        const base = 0.16 + i * 0.11;
        const top = Math.min(1, base + 0.34 - i * 0.02);
        const radius = 0.3 * (1 - i / 7.5);
        const g = new THREE.ConeGeometry(radius, top - base, 28, 4);
        // Drooping, uneven boughs: a fixed pattern by angle, so the apex stays exactly on the axis
        const p = g.attributes.position;
        for (let k = 0; k < p.count; k++) {
            const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
            const a = Math.atan2(z, x);
            const rim = 0.5 - (y / (top - base));      // 0 at the tip, 1 at the rim
            const wobble = 1 + 0.13 * Math.sin(a * 9 + i * 1.7) * rim + 0.06 * Math.sin(a * 23 + i) * rim;
            p.setXYZ(k, x * wobble, y - 0.025 * rim * rim, z * wobble);
        }
        g.computeVertexNormals();
        const tier = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: greens[i], roughness: 0.95 }));
        tier.position.y = (base + top) / 2;
        tier.rotation.y = i * 0.7;
        tier.castShadow = true;
        tier.receiveShadow = true;
        tree.add(tier);
    }
    addSimulationObject('Tree', tree, treeBody, { sound: 'wood' });

    // A surveying stick, exactly 1 m, in red and white tenths
    const stick = new THREE.Group();
    for (let i = 0; i < 10; i++) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 12), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xf1efe8 : 0xc96b62, roughness: 0.5 }));
        band.position.y = 0.05 + i * 0.1;
        band.castShadow = true;
        stick.add(band);
    }
    stick.position.set(STICK_X, 0, STICK_Z);
    scene.add(stick);

    // A few quiet details: low bushes and a stone, well away from the measurement
    [[9.5, -5, 0.9], [2.5, -6.5, 0.7], [-7.5, -5.5, 0.8]].forEach(([x, z, s]) => {
        const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 2), new THREE.MeshStandardMaterial({ color: 0x3b5e3f, roughness: 1, flatShading: true }));
        bush.position.set(x, s * 0.55, z);
        bush.scale.y = 0.7;
        bush.castShadow = true;
        scene.add(bush);
    });
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 1), realMaterial('stone', { color: 0x8a857e, size: 0.9 }));
    stone.position.set(-5.5, 0.25, -3.2);
    stone.castShadow = true;
    scene.add(stone);

    // An observer, standing at the tip of the tree's shadow to mark it
    const observer = addHuman('man', { height: 1.75, pose: h => h.setPose('stand', { time: world.time }) });
    observer.object.rotation.y = Math.PI / 2;    // Facing the tree

    // ---------- The textbook figure, drawn over the scene ----------
    const overlay = (geometry, color, opacity) => {
        const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity == null ? 0.95 : opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
        m.renderOrder = 10;
        m.raycast = noRaycast;
        m.isLine2 = true;   // Kept out of the ambient-occlusion pass
        scene.add(m);
        return m;
    };
    const rod = (color, radius, opacity) => overlay(new THREE.CylinderGeometry(radius, radius, 1, 10), color, opacity);
    const place = (m, a, b) => {
        const d = new THREE.Vector3().subVectors(b, a);
        const len = Math.max(d.length(), 1e-4);
        m.position.copy(a).addScaledVector(d, 0.5);
        m.quaternion.setFromUnitVectors(Y, d.multiplyScalar(1 / len));
        m.scale.set(1, len, 1);
        m.updateMatrixWorld();
    };

    // Text labels: a fixed-size canvas (resizing a texture is fragile), with a soft pill behind the text.
    // They keep the same size on screen at any zoom (size: share of the view's height), like a diagram's.
    const label = (color, size) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1024; canvas.height = 160;
        const ctx = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true, fog: false, sizeAttenuation: false }));
        sprite.renderOrder = 20;
        sprite.raycast = noRaycast;
        sprite.isLine2 = true;
        sprite.scale.set(size * 6.4, size, 1);
        scene.add(sprite);
        let last = null;
        return {
            sprite,
            set(text, at) {
                if (at) { sprite.position.copy(at); sprite.updateMatrixWorld(); }
                if (text === last) return;
                last = text;
                ctx.clearRect(0, 0, 1024, 160);
                ctx.font = '600 76px Inter, system-ui, sans-serif';
                const w = Math.min(1000, ctx.measureText(text).width + 64);
                const x = (1024 - w) / 2;
                ctx.fillStyle = 'rgba(17, 24, 25, 0.78)';
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(x, 18, w, 124, 62); else ctx.rect(x, 18, w, 124);
                ctx.fill();
                ctx.strokeStyle = color; ctx.globalAlpha = 0.55; ctx.lineWidth = 4; ctx.stroke(); ctx.globalAlpha = 1;
                ctx.fillStyle = color;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, 512, 84);
                texture.needsUpdate = true;
            }
        };
    };

    // A drawn sun, placed along the rays (the real sun is too far away to show in the frame)
    const sunIcon = (() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const glow = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
        glow.addColorStop(0, 'rgba(255, 236, 170, 1)');
        glow.addColorStop(0.35, 'rgba(255, 214, 120, 0.85)');
        glow.addColorStop(1, 'rgba(255, 200, 100, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, 256, 256);
        ctx.strokeStyle = 'rgba(255, 226, 150, 0.9)';
        ctx.lineWidth = 7;
        for (let i = 0; i < 12; i++) {
            const a = i * Math.PI / 6;
            ctx.beginPath();
            ctx.moveTo(128 + Math.cos(a) * 62, 128 + Math.sin(a) * 62);
            ctx.lineTo(128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92);
            ctx.stroke();
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true, fog: false, sizeAttenuation: false }));
        s.scale.set(0.1, 0.1, 1);
        s.renderOrder = 19;
        s.raycast = noRaycast;
        s.isLine2 = true;
        scene.add(s);
        return s;
    })();

    const TEAL = 0x86cbbf, SAND = 0xe8cc96, SUNLIGHT = 0xf3d27a, SOFT = 0xe6ecea;
    const heightLine = rod(TEAL, 0.05);
    const shadowLine = rod(SAND, 0.05);
    const rayLine = rod(SUNLIGHT, 0.035);
    const cornerA = rod(SOFT, 0.02), cornerB = rod(SOFT, 0.02);
    const stickShadowLine = rod(SAND, 0.025);
    const stickRay = rod(SUNLIGHT, 0.02, 0.8);
    let arcFill = null, arcEdge = null;
    const ticks = [];
    for (let i = 0; i < 45; i++) { const t = rod(SAND, 0.012, 0.85); t.visible = false; ticks.push(t); }
    const tickNumbers = [];
    for (let i = 0; i < 9; i++) { const n = label('#e8cc96', 0.022); n.sprite.visible = false; tickNumbers.push(n); }

    const hLabel = label('#86cbbf', 0.036);
    const lLabel = label('#e8cc96', 0.036);
    const thetaLabel = label('#f3d27a', 0.036);
    const sunLabel = label('#f3d27a', 0.027);
    const stickLabel = label('#e6ecea', 0.025);
    const sLabel = label('#e8cc96', 0.025);

    // ---------- Keeping everything in step with the two sliders ----------
    const fmt = (n, d) => n.toFixed(d);
    let shownTheta = null, shownHeight = null;
    const sync = () => {
        const theta = Math.min(Math.max(sunBody.mass, 20), 80);
        const H = Math.max(treeBody.mass, 0.5);
        if (theta === shownTheta && H === shownHeight) return;
        shownTheta = theta; shownHeight = H;

        const t = theta * DEG;
        const tan = Math.tan(t);
        const L = H / tan;                       // The shadow the renderer casts, worked out exactly
        const s = 1 / tan;                       // The 1 m stick's shadow
        const toSun = new THREE.Vector3(Math.cos(t), Math.sin(t), 0);

        if (sun) { sun.position.copy(toSun).multiplyScalar(60); sun.updateMatrixWorld(); }
        tree.scale.setScalar(H);
        tree.updateMatrixWorld(true);

        const base = new THREE.Vector3(TREE_X, 0.03, 0);
        const apex = new THREE.Vector3(TREE_X, H, 0);
        const tip = new THREE.Vector3(TREE_X - L, 0.03, 0);
        place(heightLine, base, apex);
        place(shadowLine, base, tip);
        place(rayLine, apex.clone().addScaledVector(toSun, 4), tip);

        // Right-angle mark at the foot of the tree, on the shadow's side
        const c = Math.min(0.7, 0.07 * H);
        place(cornerA, new THREE.Vector3(TREE_X - c, 0.03, 0), new THREE.Vector3(TREE_X - c, c, 0));
        place(cornerB, new THREE.Vector3(TREE_X - c, c, 0), new THREE.Vector3(TREE_X, c, 0));

        // The angle at the shadow's tip, between the ground (towards the tree) and the sun's ray
        [arcFill, arcEdge].forEach(m => { if (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); } });
        arcFill = overlay(new THREE.CircleGeometry(1.4, 40, 0, t), SUNLIGHT, 0.18);
        arcEdge = overlay(new THREE.RingGeometry(1.36, 1.46, 40, 1, 0, t), SUNLIGHT, 0.95);
        [arcFill, arcEdge].forEach(m => { m.position.copy(tip); m.updateMatrixWorld(); });

        // Tape measure along the shadow: a tick every metre, a number every five
        ticks.forEach((m, i) => {
            const x = i + 1;
            m.visible = x < L;
            if (m.visible) place(m, new THREE.Vector3(TREE_X - x, 0.03, -0.22), new THREE.Vector3(TREE_X - x, 0.03, x % 5 === 0 ? 0.45 : 0.22));
        });
        tickNumbers.forEach((n, i) => {
            const x = (i + 1) * 5;
            n.sprite.visible = x < L - 0.6;
            if (n.sprite.visible) n.set(x + ' m', new THREE.Vector3(TREE_X - x, 0.25, 0.95));
        });

        // The 1 m stick: the same parallel rays, a smaller similar triangle
        const stickBase = new THREE.Vector3(STICK_X, 0.03, STICK_Z), stickTop = new THREE.Vector3(STICK_X, 1, STICK_Z);
        const stickTip = new THREE.Vector3(STICK_X - s, 0.03, STICK_Z);
        place(stickShadowLine, stickBase, stickTip);
        place(stickRay, stickTop.clone().addScaledVector(toSun, 2.5), stickTip);

        // The observer stands at the tip of the tree's shadow, a little to the side
        observer.object.position.set(TREE_X - L - 0.3, 0, 1.3);
        observer.object.updateMatrixWorld(true);

        // Labels
        hLabel.set('h = ' + fmt(H, 2) + ' m', new THREE.Vector3(TREE_X + 0.3 * H + 1.6, H * 0.5, 0));
        lLabel.set('L = ' + fmt(L, 2) + ' m', new THREE.Vector3(TREE_X - L / 2, 0.3, 1.8));
        thetaLabel.set('θ = ' + fmt(theta, 1) + '°', tip.clone().add(new THREE.Vector3(2.9, 0.8, 0)));
        sunIcon.position.copy(apex).addScaledVector(toSun, 4.2);
        sunIcon.updateMatrixWorld();
        sunLabel.set('Sun’s rays (parallel)', apex.clone().addScaledVector(toSun, 4.2).add(new THREE.Vector3(-4.2, 0.4, 0)));
        stickLabel.set('1 m stick', stickTop.clone().add(new THREE.Vector3(0, 0.55, 0)));
        sLabel.set('s = ' + fmt(s, 2) + ' m', new THREE.Vector3(STICK_X - s / 2, 0.2, STICK_Z - 0.8));

        // The readout: the measurement worked through, step by step
        const angleError = 100 * DEG / (Math.sin(t) * Math.cos(t));
        const near = (a) => Math.abs(theta - a) < 0.26;
        const tip45 = near(45) ? 'At 45° the shadow is exactly as long as the tree: tan 45° = 1.'
            : near(30) ? 'At 30°: h = L ÷ √3 ≈ 0.577 × L.'
            : near(60) ? 'At 60°: h = L × √3 ≈ 1.732 × L.'
            : 'Try 30°, 45° or 60°: special angles need no calculator.';
        setReadout('Height of a tree from its shadow', [
            ['Sun’s elevation θ', fmt(theta, 1) + '°'],
            ['Shadow length L', fmt(L, 2) + ' m'],
            ['tan θ', fmt(tan, 3)],
            ['Height h = L × tan θ', fmt(L * tan, 2) + ' m'],
            ['1 m stick’s shadow s', fmt(s, 2) + ' m'],
            ['Similar triangles h = L ÷ s', fmt(L / s, 2) + ' m'],
            ['1° error in θ changes h by', fmt(angleError, 1) + '%'],
            tip45
        ]);
    };
    sync();
    // Runs whenever the scene is drawn, so the figure follows the sliders even while paused
    ground.mesh.onBeforeRender = sync;
    addClickCallback(label => label === 'Tree' || label === 'Sun');
  `,
  sliders: [
    { label: "Sun's Elevation (°)", targetLabel: "Sun", property: "mass", min: 25, max: 75, value: 40, step: 0.5 },
    { label: "Tree Height (m)", targetLabel: "Tree", property: "mass", min: 4, max: 20, value: 10, step: 0.5 }
  ]
};
