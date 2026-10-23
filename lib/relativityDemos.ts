import { SimulationData } from '../types';

// Special relativity demo: time dilation and the twin paradox, on a trip to Proxima Centauri and back.
// Anna stays home with a row of synchronised light clocks (Earth's frame); her twin Ben flies there and back
// carrying an identical light clock. Seen from Earth, his clock's light pulse runs along a zigzag: the longer,
// diagonal path that makes each of his ticks take γ times longer. A live triangle on the pulse shows why:
// (cΔt)² = (cΔτ)² + (vΔt)², so Δt = γΔτ. His rocket is also shortened by 1/γ along its motion.
// Scale: 1 second on screen = 1 year; the route is to scale (4.24 light-years). The light clocks are drawn huge
// (mirrors about 0.76 light-years apart) so their pulses can be followed.
// State that must survive replay and rewind lives in body positions (the timeline records them): the rocket's
// position and heading, and the twins' clocks and the trip's result in hidden bodies. Everything drawn is
// worked out from those, each time the scene is drawn.
export const TIME_DILATION: SimulationData = {
  demoMode: true,
  startMode: 'click',
  startHint: "Click anywhere to launch Ben's rocket to Proxima Centauri",
  thought_process: "Scenario: Time dilation and the twin paradox. Anna stays on Earth; her twin Ben flies to Proxima Centauri (4.24 light-years away) and back at a steady speed v.\n\nThe light clock:\n- A pulse of light bouncing between two mirrors a fixed distance apart. One tick is one round trip.\n- Every kind of clock (atomic clocks, heartbeats, ageing) keeps step with it, because the laws of physics are the same in every frame moving at constant velocity. So whatever happens to the light clock happens to Ben.\n\nWhy a moving clock runs slow:\n- Seen from Earth, Ben's rocket moves while his pulse is in flight, so the pulse runs along a diagonal (the zigzag trail). Light has the same speed c for every observer (Einstein's second postulate), so a longer path takes longer.\n- In one trip between the mirrors: Ben measures the time Δτ (the pulse goes straight across, a distance cΔτ). Earth measures the longer time Δt: the pulse covers cΔt along the diagonal while the rocket moves vΔt. The live triangle on the pulse shows this.\n- Pythagoras: (cΔt)² = (cΔτ)² + (vΔt)², so Δt = γ·Δτ with the Lorentz factor γ = 1 / √(1 − v²/c²).\n\nThe numbers:\n- γ at 0.1c = 1.005, at 0.5c = 1.155, at 0.8c = 1.667, at 0.9c = 2.294, at 0.99c = 7.09, at 0.999c = 22.4.\n- At 0.8c the round trip of 8.48 light-years takes 10.6 years on Earth, but only 10.6 ÷ 1.667 = 6.36 years on Ben's clock. He comes home 4.24 years younger than Anna.\n\nLength contraction:\n- Seen from Earth, the moving rocket is shorter along its motion by the same factor: L = L₀ ÷ γ.\n- Ben, for his part, sees the distance to Proxima shortened by γ. That is how his own measurements agree with his shorter trip.\n\nWhy it is not symmetric (the paradox):\n- While they move apart at constant speed, each twin sees the other's clock run slow. That is symmetric.\n- But Ben turns round at Proxima: he changes from one inertial frame to another, and Anna never does. That breaks the symmetry. Every observer agrees on the result when they meet again: Ben is younger.\n\nIt is real, and measured:\n- Muons made by cosmic rays 15 km up live only 2.2 μs, too short to reach the ground even at nearly the speed of light, yet we detect them at sea level: their clocks run slow by γ ≈ 10 to 40.\n- Particle accelerators keep unstable particles alive γ times longer than at rest.\n- In 1971 Hafele and Keating flew atomic clocks round the world on airliners and measured the predicted differences (tens to hundreds of nanoseconds).\n- GPS satellites' clocks run 7 μs a day slow because of their speed and 45 μs a day fast in weaker gravity. The net 38 μs a day is corrected; without it, GPS positions would drift by about 10 km a day.\n\nIn this view: 1 second = 1 year, and the route is to scale. The light clocks are drawn huge (mirrors about 0.76 light-years apart, one tick about 1.5 years) so you can see the pulses. Real light clocks tick billions of times a second, but every clock is slowed by the same factor γ.\n\nTry it: set the speed to 0.5c, then 0.99c, and watch the zigzag stretch and Ben's clock nearly stop. Press 0 to follow the rocket. Rewind with the timeline to replay the trip.",
  code: `
    world.gravity.set(0, 0, 0);
    world.allowSleep = false;
    setAmbience('space');
    scene.background = new THREE.Color(0x02030a);
    if (scene.fog) { scene.fog.near = 400; scene.fog.far = 900; }
    camera.position.set(0, 4.5, 44);
    camera.userData.lookAt = [0, 4, 0];

    // Starlight from the left (the Sun's direction) and a little fill; no studio spotlights in space
    scene.children.forEach(o => {
        if (o.isDirectionalLight) { o.intensity = 1.7; o.position.set(-30, 18, 25); }
        if (o.isAmbientLight) o.intensity = 0.3;
        if (o.isHemisphereLight || o.isSpotLight) o.intensity = 0;
    });

    // ---------- Units ----------
    const LY = 4.24;                    // Earth to Proxima Centauri, light-years
    const START = -14, TURN = 14;       // Where Ben sets off and where he turns round (scene units)
    const C = (TURN - START) / LY;      // The speed of light in scene units per second (1 second shown = 1 year)
    const L = 5;                        // A light clock's mirror separation (scene units)
    const SHIP_Y = 0, SHIP_Z = 2;       // Ben's lane
    const EARTH_Y = 7.5, EARTH_Z = -1;  // The row of Earth's clocks, above it
    const AGE = 30;                     // The twins' age when Ben sets off
    const noRaycast = () => {};
    const tri = u => { const p = ((u % 2) + 2) % 2; return p < 1 ? p : 2 - p; };   // 0 → 1 → 0 as u runs 0 → 2

    // ---------- The speed control: a fixed body whose 'mass' the slider sets (v as a fraction of c) ----------
    const speedBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, shape: new CANNON.Sphere(0.1) });
    speedBody.collisionFilterGroup = 0; speedBody.collisionFilterMask = 0;
    speedBody.mass = 0.8;
    addSimulationObject('Speed', new THREE.Group(), speedBody, { sound: 'soft' });
    const beta = () => Math.min(Math.max(speedBody.mass, 0.05), 0.995);
    const gammaOf = b => 1 / Math.sqrt(1 - b * b);

    // The twins' clocks and the trip's result, kept in hidden bodies' positions so replay and rewind restore them:
    // clocks: x = Ben's clock, y = Anna's clock (years since launch); arrival: x = Anna's clock when he got home
    // (0 until then), y = Ben's clock then
    const hidden = () => {
        const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Sphere(0.01) });
        body.collisionFilterGroup = 0; body.collisionFilterMask = 0;
        world.addBody(body);
        return body;
    };
    const clocks = hidden(), arrival = hidden();

    // ---------- Materials ----------
    const hullMat = realMaterial('painted-metal', { color: 0xe9edf0 });
    const trimMat = realMaterial('painted-metal', { color: 0x2b4a5e });
    const steel = realMaterial('brushed-steel', { size: 1 });
    // (Polished metal would mirror black space and vanish: the plates are a light, softly lit alloy instead)
    const mirrorMat = new THREE.MeshStandardMaterial({ color: 0xc9d6dc, metalness: 0.25, roughness: 0.4, emissive: 0x1d3540, emissiveIntensity: 0.7 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: 0x0e3a52, emissiveIntensity: 0.6, transparent: true, opacity: 0.2, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
    const mirrorFace = () => new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x58b8e8, emissiveIntensity: 0.5, roughness: 0.2 });

    // ---------- A light clock: two mirrors facing each other across a glass tube ----------
    // Its mirror faces glow for a moment each time the pulse arrives: that is a tick.
    const makeClock = (faces) => {
        const g = new THREE.Group();
        [-1, 1].forEach((s, i) => {
            const plate = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.14, 0.95), mirrorMat);
            plate.position.y = s * (L / 2 + 0.09);
            g.add(plate);
            const face = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.07, 0.8), faces[i]);
            face.position.y = s * (L / 2 - 0.015);
            g.add(face);
        });
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, L, 32, 1, true), glass);
        tube.renderOrder = 5;
        g.add(tube);
        [-0.5, 0.5].forEach(x => {
            const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, L + 0.3, 8), steel);
            strut.position.set(x, 0, -0.42);
            g.add(strut);
        });
        return g;
    };

    // A glowing dot for a light pulse, drawn over everything (it passes through the rocket's hull)
    const glowTexture = (() => {
        const c = document.createElement('canvas'); c.width = c.height = 128;
        const x = c.getContext('2d');
        const grad = x.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,240,200,0.75)'); grad.addColorStop(1, 'rgba(255,220,150,0)');
        x.fillStyle = grad; x.fillRect(0, 0, 128, 128);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        return t;
    })();
    const makePulse = (colour) => {
        const g = new THREE.Group();
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), new THREE.MeshBasicMaterial({ color: colour, depthTest: false, depthWrite: false }));
        core.renderOrder = 31; core.raycast = noRaycast; core.isLine2 = true;
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: colour, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }));
        halo.scale.set(1.3, 1.3, 1); halo.renderOrder = 30; halo.raycast = noRaycast; halo.isLine2 = true;
        g.add(core, halo);
        scene.add(g);
        return g;
    };

    // ---------- Anna's clocks: a row of synchronised light clocks at rest in Earth's frame ----------
    const earthFaces = [mirrorFace(), mirrorFace()];
    const EARTH_XS = [-14, -7, 0, 7, 14];
    const earthPulses = EARTH_XS.map(x => {
        const clock = makeClock(earthFaces);
        clock.position.set(x, EARTH_Y, EARTH_Z);
        scene.add(clock);
        return makePulse(0xffe9b0);
    });
    const rail = new THREE.Mesh(new THREE.BoxGeometry(31, 0.12, 0.3), trimMat);
    rail.position.set(0, EARTH_Y - L / 2 - 0.32, EARTH_Z - 0.42);
    rail.frustumCulled = false;   // Its onBeforeRender keeps the whole scene in step (see the end)
    scene.add(rail);

    // ---------- Ben's rocket, nose along +x, his light clock passing through the middle of the hull ----------
    const ship = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 4.4, 40), hullMat);
    hull.rotation.z = Math.PI / 2;
    ship.add(hull);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.78, 1.7, 40), hullMat);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 3.05;
    ship.add(nose);
    [1.25, -1.55].forEach(x => {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.32, 40), trimMat);
        band.rotation.z = Math.PI / 2; band.position.x = x;
        ship.add(band);
    });
    const windows = new THREE.Mesh(new THREE.CylinderGeometry(0.79, 0.79, 0.12, 40), new THREE.MeshStandardMaterial({ color: 0x9fe6ff, emissive: 0x6fd0ff, emissiveIntensity: 1.1, roughness: 0.3 }));
    windows.rotation.z = Math.PI / 2; windows.position.x = 2.0;
    ship.add(windows);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.55, 0.8, 32, 1, true), steel);
    bell.rotation.z = Math.PI / 2; bell.position.x = -2.6;
    bell.material = steel.clone(); bell.material.side = THREE.DoubleSide;
    ship.add(bell);
    for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2;   // Diagonal fins, clear of the clock
        const fin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.85, 0.07), trimMat);
        fin.position.set(-1.75, Math.cos(a) * 1.15, Math.sin(a) * 1.15);
        fin.rotation.x = a;
        ship.add(fin);
    }
    const shipFaces = [mirrorFace(), mirrorFace()];
    ship.add(makeClock(shipFaces));
    // The engine's flame, shown while the rocket travels
    const flame = new THREE.Group();
    [[0.62, 2.6, 0xff9a4a, 0.55], [0.34, 1.7, 0xfff0c0, 0.85]].forEach(([r, len, colour, opacity]) => {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(r, len, 24, 1, true), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        cone.rotation.z = Math.PI / 2;          // Apex towards -x
        cone.position.x = -3.0 - len / 2;
        cone.raycast = noRaycast;
        flame.add(cone);
    });
    flame.visible = false;
    ship.add(flame);

    const shipBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Box(new CANNON.Vec3(2.9, 0.8, 0.8)) });
    shipBody.collisionFilterGroup = 0; shipBody.collisionFilterMask = 0;
    shipBody.position.set(START, SHIP_Y, SHIP_Z);
    addSimulationObject('Ship', ship, shipBody, { sound: 'metal', main: true });
    const shipPulse = makePulse(0xfff3c4);
    // Heading: nose along +x on the way out, turned round (half a turn about y) on the way home
    const heading = () => (Math.abs(shipBody.quaternion.y) > 0.5 ? -1 : 1);

    // ---------- The route's ends: Earth and Proxima Centauri (scenery, kept out of the camera's framing) ----------
    const canvasMap = (w, h, draw) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        draw(c.getContext('2d'));
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        return t;
    };
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const scenery = (m) => { m.isLine2 = true; m.raycast = noRaycast; scene.add(m); return m; };
    const earth = scenery(new THREE.Mesh(new THREE.SphereGeometry(6, 64, 48), new THREE.MeshStandardMaterial({ roughness: 0.75, map: canvasMap(1024, 512, g => {
        const sea = g.createLinearGradient(0, 0, 0, 512);
        sea.addColorStop(0, '#1b3f73'); sea.addColorStop(0.5, '#1f5c98'); sea.addColorStop(1, '#1b3f73');
        g.fillStyle = sea; g.fillRect(0, 0, 1024, 512);
        for (let k = 0; k < 8; k++) {
            const cx = rnd() * 1024, cy = 110 + rnd() * 290;
            for (let i = 0; i < 40; i++) {
                const x = cx + (rnd() - 0.5) * 220, y = cy + (rnd() - 0.5) * 130, r = 10 + rnd() * 30;
                g.fillStyle = rnd() < 0.65 ? '#4d7a3c' : '#8c7b52';
                [x, x - 1024, x + 1024].forEach(xx => { g.beginPath(); g.arc(xx, y, r, 0, Math.PI * 2); g.fill(); });
            }
        }
        g.fillStyle = '#eef3f6'; g.fillRect(0, 0, 1024, 26); g.fillRect(0, 486, 1024, 26);
    }) })));
    earth.position.set(-25, 3.5, -12);
    const clouds = scenery(new THREE.Mesh(new THREE.SphereGeometry(6.12, 64, 48), new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, roughness: 1, map: canvasMap(1024, 512, g => {
        for (let i = 0; i < 260; i++) {
            const x = rnd() * 1024, y = 60 + rnd() * 392, r = 8 + rnd() * 26;
            g.fillStyle = 'rgba(255,255,255,' + (0.25 + rnd() * 0.45) + ')';
            g.beginPath(); g.ellipse(x, y, r * 2.2, r, 0, 0, Math.PI * 2); g.fill();
        }
    }) })));
    clouds.position.copy(earth.position);
    const halo = (colour, size, at) => {
        const s = scenery(new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: colour, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 })));
        s.scale.set(size, size, 1); s.position.copy(at);
        return s;
    };
    halo(0x6fb4ff, 16.5, earth.position);
    const proxima = scenery(new THREE.Mesh(new THREE.SphereGeometry(2.3, 48, 32), new THREE.MeshBasicMaterial({ color: 0xff7a45 })));
    proxima.position.set(25, 5, -14);
    halo(0xff6a3a, 15, proxima.position);
    const starLight = new THREE.PointLight(0xff8a5a, 40, 0, 2);
    starLight.position.copy(proxima.position);
    scene.add(starLight);
    const planetB = scenery(new THREE.Mesh(new THREE.SphereGeometry(0.85, 40, 28), realMaterial('stone', { color: 0xb07a5a, size: 2 })));
    planetB.position.set(20.5, 2.6, -9);

    // A faint line along the route
    const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(START - 3, SHIP_Y, SHIP_Z - 0.9), new THREE.Vector3(TURN + 3, SHIP_Y, SHIP_Z - 0.9)]), new THREE.LineBasicMaterial({ color: 0x5f7f8a, transparent: true, opacity: 0.45 }));
    route.raycast = noRaycast;
    scene.add(route);

    // Stars
    (() => {
        const n = 2600, p = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
            p[i * 3] = 380 * s * Math.cos(a); p[i * 3 + 1] = 380 * u; p[i * 3 + 2] = 380 * s * Math.sin(a);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(p, 3));
        const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.5, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
        stars.frustumCulled = false; stars.renderOrder = -2;
        scene.add(stars);
    })();

    // ---------- The trail of Ben's light pulse, as seen from Earth (a ribbon in the plane of his lane) ----------
    const MAX = 1400;
    const trailPos = new Float32Array(MAX * 6), trailCol = new Float32Array(MAX * 6);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    const index = [];
    for (let i = 0; i < MAX - 1; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    trailGeo.setIndex(index);
    trailGeo.setDrawRange(0, 0);
    const trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    trail.frustumCulled = false; trail.renderOrder = 25; trail.raycast = noRaycast; trail.isLine2 = true;
    scene.add(trail);
    const points = [];     // [x, y] of the pulse, oldest first
    const drawTrail = () => {
        const n = points.length, w = 0.075;
        for (let i = 0; i < n; i++) {
            const p = points[i], a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
            const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len * w, ny = dx / len * w, o = i * 6;
            trailPos[o] = p[0] + nx; trailPos[o + 1] = p[1] + ny; trailPos[o + 2] = SHIP_Z + 0.05;
            trailPos[o + 3] = p[0] - nx; trailPos[o + 4] = p[1] - ny; trailPos[o + 5] = SHIP_Z + 0.05;
            const f = 0.1 + 0.9 * Math.pow((i + 1) / n, 1.5);   // Older parts fade
            trailCol[o] = trailCol[o + 3] = 1.0 * f; trailCol[o + 1] = trailCol[o + 4] = 0.82 * f; trailCol[o + 2] = trailCol[o + 5] = 0.45 * f;
        }
        trailGeo.attributes.position.needsUpdate = true;
        trailGeo.attributes.color.needsUpdate = true;
        trailGeo.setDrawRange(0, Math.max(0, n - 1) * 6);
    };

    // ---------- Overlays: the live triangle and the labels ----------
    const Y = new THREE.Vector3(0, 1, 0);
    const rod = (colour, radius) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 10), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
        m.renderOrder = 28; m.raycast = noRaycast; m.isLine2 = true; m.visible = false;
        scene.add(m);
        return m;
    };
    const tmp = new THREE.Vector3();
    const place = (m, a, b) => {
        tmp.subVectors(b, a);
        const len = Math.max(tmp.length(), 1e-4);
        m.position.copy(a).addScaledVector(tmp, 0.5);
        m.quaternion.setFromUnitVectors(Y, tmp.multiplyScalar(1 / len));
        m.scale.set(1, len, 1);
    };
    const TEAL = 0x86cbbf, SAND = 0xe8cc96, LIGHT = 0xffe08a;
    const legTau = rod(TEAL, 0.05), legV = rod(SAND, 0.05), legC = rod(LIGHT, 0.04);

    // Labels: a fixed-size canvas with a soft pill behind the text; they keep their size on screen at any zoom.
    // Long text is set smaller so it always fits.
    const label = (colour, size) => {
        const W = 768, H = 112;
        const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true, fog: false, sizeAttenuation: false }));
        sprite.renderOrder = 40; sprite.raycast = noRaycast; sprite.isLine2 = true;
        sprite.scale.set(size * W / H, size, 1);
        scene.add(sprite);
        let last = null;
        return {
            sprite,
            set(text, x, y, z) {
                if (x !== undefined) sprite.position.set(x, y, z);
                if (text === last) return;
                last = text;
                ctx.clearRect(0, 0, W, H);
                ctx.font = '600 50px Inter, system-ui, sans-serif';
                const natural = ctx.measureText(text).width;
                if (natural > W - 64) ctx.font = '600 ' + Math.floor(50 * (W - 64) / natural) + 'px Inter, system-ui, sans-serif';
                const w = Math.min(W - 8, ctx.measureText(text).width + 48), left = (W - w) / 2;
                ctx.fillStyle = 'rgba(12, 18, 22, 0.8)';
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(left, 12, w, 88, 44); else ctx.rect(left, 12, w, 88);
                ctx.fill();
                ctx.strokeStyle = colour; ctx.globalAlpha = 0.5; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = 1;
                ctx.fillStyle = colour; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(text, W / 2, 58);
                texture.needsUpdate = true;
            }
        };
    };
    // Rows, top to bottom: the law, γ, Anna's clocks | the clocks | Ben's clock (follows him), the route, the result
    const ROW = { formula: 15.8, gamma: 13.7, earth: 11.6, ship: -3.9, route: -7.2, result: -9.4 };
    const formulaLabel = label('#f2f5f4', 0.04);
    const gammaLabel = label('#f2f5f4', 0.034);
    const earthClockLabel = label('#86cbbf', 0.036);
    const shipClockLabel = label('#ffe08a', 0.036);
    const tauLabel = label('#86cbbf', 0.03), vLabel = label('#e8cc96', 0.03), cLabel = label('#ffe08a', 0.03);
    const resultLabel = label('#9fe0a8', 0.038);
    label('#cfd8dc', 0.03).set('Route: Earth → Proxima Centauri, 4.24 light-years', 0, ROW.route, SHIP_Z);
    formulaLabel.set('Moving clocks run slow:  Δt = γ·Δτ', 0, ROW.formula, EARTH_Z);
    [tauLabel, vLabel, cLabel, resultLabel].forEach(l => { l.sprite.visible = false; });
    // An invisible box over the label rows, so the opening shot always includes them
    const frame = new THREE.Mesh(new THREE.BoxGeometry(34, ROW.formula - ROW.result + 2, 0.1), new THREE.MeshBasicMaterial({ visible: false }));
    frame.position.set(0, (ROW.formula + ROW.result) / 2, SHIP_Z);
    frame.raycast = noRaycast;
    scene.add(frame);

    // ---------- Physics: Ben's trip, step by step ----------
    // Anna's clock advances dt for every dt of Earth time; Ben's advances dt/γ while he travels (dt once he is
    // home, where the twins' clocks agree again). The step is worked out from world.time, so steps that do not
    // move time on (arranging) do nothing. Both clocks are integrated with the same steps, so they always agree.
    let lastTime = world.time;
    world.addEventListener('postStep', () => {
        const now = world.time, dt = now - lastTime;
        lastTime = now;
        if (!(dt > 0 && dt < 0.25)) return;
        clocks.position.y += dt;
        if (arrival.position.x > 0) { clocks.position.x += dt; return; }
        const b = beta(), g = gammaOf(b);
        clocks.position.x += dt / g;
        const dir = heading();
        shipBody.position.x += dir * b * C * dt;
        if (dir > 0 && shipBody.position.x >= TURN) {
            shipBody.position.x = TURN - (shipBody.position.x - TURN);
            shipBody.quaternion.setFromEuler(0, Math.PI, 0);       // Turned round at Proxima
        } else if (dir < 0 && shipBody.position.x <= START) {
            // Home: the arrival fell part-way through this step, so the clocks are read at that exact moment,
            // and the rest of the step is time spent at rest
            const late = (START - shipBody.position.x) / (b * C);
            shipBody.position.x = START;
            arrival.position.set(clocks.position.y - late, clocks.position.x - late / g, 0);
            clocks.position.x += late - late / g;
        }
    });

    // ---------- Drawing it all, from the bodies and world.time ----------
    const lo = (yMid) => yMid - L / 2;
    // A mirror face glows as the pulse reaches it
    const flash = (face, d) => { face.emissiveIntensity = 0.5 + 2.6 * Math.max(0, 1 - d / 0.1); };
    let lastSync = null, lastSample = null, lastBounce = null, lastHeading = 1, lastLabels = 0, labelsPending = true;
    const sync = () => {
        const now = world.time, b = beta(), g = gammaOf(b), tau = clocks.position.x, tE = clocks.position.y;
        const stamp = now + ':' + b + ':' + tau + ':' + tE;
        const t = performance.now();
        // Nothing changed since the last frame, and no text left to refresh: nothing to do
        if (stamp === lastSync && !(labelsPending && t - lastLabels > 90)) return;
        const changed = stamp !== lastSync;
        lastSync = stamp;

        const home = arrival.position.x > 0, started = tE > 0;
        const moving = started && !home;
        const dir = heading();
        const x = shipBody.position.x;

        // Anna's clocks: all in step, the pulse straight up and down
        const uE = tE * C / L, yE = lo(EARTH_Y) + L * tri(uE), phaseE = ((uE % 2) + 2) % 2;
        earthPulses.forEach((p, i) => p.position.set(EARTH_XS[i], yE, EARTH_Z));
        flash(earthFaces[0], Math.min(phaseE, 2 - phaseE));
        flash(earthFaces[1], Math.abs(phaseE - 1));

        // Ben's clock: the same pulse in his own time τ, carried along with the rocket
        const u = tau * C / L, yS = lo(SHIP_Y) + L * tri(u), phaseS = ((u % 2) + 2) % 2;
        shipPulse.position.set(x, yS, SHIP_Z);
        flash(shipFaces[0], Math.min(phaseS, 2 - phaseS));
        flash(shipFaces[1], Math.abs(phaseS - 1));

        // Seen from Earth, the moving rocket is shorter along its motion by 1/γ; the engine burns while it travels
        ship.scale.x = moving ? 1 / g : 1;
        flame.visible = moving;
        if (moving) flame.scale.set(0.9 + 0.12 * Math.sin(now * 47) + 0.06 * Math.sin(now * 113), 1, 1);
        earth.rotation.y = tE * 0.35; clouds.rotation.y = tE * 0.42;

        // The trail: added to as time runs on; cleared when time goes back (rewind) or the trip restarts
        if (lastSample && (now < lastSample.t - 1e-6 || !started)) { points.length = 0; lastSample = null; lastBounce = null; drawTrail(); }
        if (dir !== lastHeading) { lastBounce = null; lastHeading = dir; }   // The path bends at the turn
        // (Added while he travels, plus the moment he arrives home)
        if (started && (!home || (lastSample && !lastSample.home))) {
            if (!lastSample) {
                lastSample = { t: now, u, x, home };
                points.push([x, yS]);
                drawTrail();
            } else if (now > lastSample.t) {
                // Corners where the pulse met a mirror, so the zigzag stays sharp
                for (let k = Math.floor(lastSample.u) + 1; k <= Math.floor(u); k++) {
                    const f = (k - lastSample.u) / Math.max(u - lastSample.u, 1e-9);
                    const corner = [lastSample.x + (x - lastSample.x) * f, lo(SHIP_Y) + (k % 2 ? L : 0)];
                    points.push(corner);
                    lastBounce = corner;
                }
                points.push([x, yS]);
                while (points.length > MAX) points.shift();
                lastSample = { t: now, u, x, home };
                drawTrail();
            }
        }
        if (!started) { points.length = 0; drawTrail(); }

        // The live triangle on the pulse's current crossing: up the rocket (cΔτ), along with it (vΔt), and the
        // light's own path (cΔt)
        if (moving && !lastBounce) {
            // After a rewind: where the last crossing began, at the present speed (good while the speed is unchanged)
            const back = (u - Math.floor(u)) * (L / C) * g * b * C;
            const bx = x - dir * back;
            if (bx >= START - 0.01 && bx <= TURN + 0.01) lastBounce = [bx, lo(SHIP_Y) + (Math.floor(u) % 2 ? L : 0)];
        }
        const showTriangle = moving && lastBounce && Math.abs(x - lastBounce[0]) > 0.15 && Math.abs(yS - lastBounce[1]) > 0.15;
        // Its names appear once it is big enough for them not to crowd each other
        const named = showTriangle && Math.abs(x - lastBounce[0]) > 2.2 && Math.abs(yS - lastBounce[1]) > 1.4;
        [legTau, legV, legC].forEach(m => { m.visible = !!showTriangle; });
        [tauLabel.sprite, vLabel.sprite, cLabel.sprite].forEach(m => { m.visible = !!named; });
        if (showTriangle) {
            const A = new THREE.Vector3(lastBounce[0], lastBounce[1], SHIP_Z + 0.1);
            const V = new THREE.Vector3(lastBounce[0], yS, SHIP_Z + 0.1);
            const P = new THREE.Vector3(x, yS, SHIP_Z + 0.1);
            place(legTau, A, V); place(legV, V, P); place(legC, A, P);
            const up = yS > lastBounce[1] ? 1 : -1;
            tauLabel.set('cΔτ', A.x - dir * 1.3, (A.y + V.y) / 2, SHIP_Z);
            vLabel.set('vΔt', (V.x + P.x) / 2, yS + up * 0.75, SHIP_Z);
            cLabel.set('cΔt', (A.x + P.x) / 2 + dir * 0.9, (A.y + P.y) / 2 - up * 0.6, SHIP_Z);
        }

        // Ben's label follows him every frame; its text, like all the others, is redrawn about eleven times a
        // second (often enough to read, cheap to draw) and always once more after the last change
        shipClockLabel.sprite.position.set(x, ROW.ship, SHIP_Z);
        resultLabel.sprite.visible = home;
        if (changed) labelsPending = true;
        if (labelsPending && (t - lastLabels > 90 || !started)) {
            lastLabels = t;
            labelsPending = false;
            gammaLabel.set('γ = 1/√(1 − v²/c²) = ' + g.toFixed(3) + '  at  v = ' + b.toFixed(2) + 'c', 0, ROW.gamma, EARTH_Z);
            earthClockLabel.set('Anna’s clocks on Earth:  ' + tE.toFixed(2) + ' yr', 0, ROW.earth, EARTH_Z);
            shipClockLabel.set('Ben’s clock:  ' + tau.toFixed(2) + ' yr');
            if (home) resultLabel.set('Home!  Anna aged ' + arrival.position.x.toFixed(2) + ' yr,  Ben only ' + arrival.position.y.toFixed(2) + ' yr', 0, ROW.result, SHIP_Z);
            const younger = tE - tau;
            const note = !started ? 'Two identical light clocks: one tick is one round trip of the pulse. Click to launch Ben’s rocket.'
                : home ? 'Ben turned round at Proxima (he changed frames; Anna never did), so the effect is real: he came home ' + (arrival.position.x - arrival.position.y).toFixed(2) + ' yr younger.'
                : 'Seen from Earth, Ben’s pulse runs along the longer diagonal (cΔt), so each of his ticks takes γ times longer: Δt = γ·Δτ.';
            setReadout('Time dilation · the twin paradox', [
                ['Ship speed v', b.toFixed(2) + ' c · ' + Math.round(b * 299792.458).toLocaleString('en-US') + ' km/s'],
                ['Lorentz factor γ', g.toFixed(3)],
                ['Anna on Earth', tE.toFixed(2) + ' yr (age ' + (AGE + tE).toFixed(1) + ')'],
                ['Ben on the rocket', tau.toFixed(2) + ' yr (age ' + (AGE + tau).toFixed(1) + ')'],
                ['Ben is younger by', younger.toFixed(2) + ' yr'],
                ['Light-clock ticks', 'Earth ' + Math.floor(uE / 2) + ' · Ben ' + Math.floor(u / 2)],
                ['Rocket length seen from Earth', Math.round(100 * (moving ? 1 / g : 1)) + '% (L₀ ÷ γ)'],
                note
            ]);
        }
    };
    sync();
    // Runs whenever the scene is drawn: playing, paused, replaying or waiting for the start click
    rail.onBeforeRender = sync;
    // The rocket's shape is relativity's to change (its length contracts): a click on it is not an edit
    addClickCallback(name => name === 'Ship');
  `,
  sliders: [
    { label: "Ship Speed (× c)", targetLabel: "Speed", property: "mass", min: 0.1, max: 0.99, value: 0.8, step: 0.01 }
  ]
};
