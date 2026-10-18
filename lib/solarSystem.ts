import { SimulationData } from '../types';

// Solar System demo: all eight planets with procedurally painted surfaces, real axial tilts,
// correct ordering and relative size ranking. Sizes and distances are compressed so everything
// fits on screen (true scale would make the planets invisible specks).
export const SOLAR_SYSTEM: SimulationData = {
  demoMode: true,
  startMode: 'auto', // Continuous motion: nothing to trigger
  thought_process: "ANALYSIS COMPLETE.\n\nScenario: Orbital Mechanics (The Solar System).\nVisuals: Sun, eight planets, the Moon, Saturn's rings, asteroid belt and a comet.\nPhysics Profile:\n- Force law: Newtonian gravity, F = G*M*m / r^2.\n- Kepler's 3rd law: Inner planets orbit faster than outer ones.\n- Lighting: Sunlight only, so every world has a day and night side.\n- Axial tilt: Real values (Earth 23.4, Saturn 26.7, Uranus 97.8 degrees).\nScale note: Sizes and distances are compressed to fit the view.\n\nInitializing simulation...",
  code: `
    world.gravity.set(0, 0, 0);
    setAmbience('space'); // Vacuum: a faint drone, and no air noise as bodies move
    world.allowSleep = false;
    world.solver.iterations = 10;
    if (scene.fog) { scene.fog.near = 150; scene.fog.far = 500; }
    camera.position.set(0, 34, 56);

    // Space is lit by the Sun alone: mute the studio lights
    scene.children.forEach(o => {
        if (o.isDirectionalLight) o.intensity = 0;
        if (o.isAmbientLight) o.intensity = 0.1;
    });

    const G = 0.4;
    const SUN_MASS = 1000;
    const DEG = Math.PI / 180;

    // ---------- Procedural surface painting ----------
    let seed = 20240607;
    const rand = () => {
        seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    const hasCanvas = typeof document !== 'undefined';
    const paint = (draw, w = 512, h = 256) => {
        if (!hasCanvas) return null;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        draw(c.getContext('2d'), w, h);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    };
    const fill = (g, w, h, color) => { g.fillStyle = color; g.fillRect(0, 0, w, h); };
    // Horizontal latitude bands
    const bands = (g, w, h, stops) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
    };
    // Random soft patches, wrapped across the left/right seam
    const blobs = (g, w, h, n, colors, minR, maxR, alpha, stretch = 1, yMin = 0, yMax = 1) => {
        for (let i = 0; i < n; i++) {
            const x = rand() * w;
            const y = (yMin + rand() * (yMax - yMin)) * h;
            const ry = minR + rand() * (maxR - minR);
            const rx = ry * stretch * (0.7 + rand() * 0.6);
            g.globalAlpha = alpha * (0.5 + rand() * 0.5);
            g.fillStyle = colors[Math.floor(rand() * colors.length)];
            [-w, 0, w].forEach(dx => { g.beginPath(); g.ellipse(x + dx, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); });
        }
        g.globalAlpha = 1;
    };
    const caps = (g, w, h, size, color) => {
        g.fillStyle = color;
        g.fillRect(0, 0, w, h * size);
        g.fillRect(0, h * (1 - size), w, h * size);
        blobs(g, w, h, 40, [color], 3, 9, 0.9, 2, size * 0.6, size * 1.5);
        blobs(g, w, h, 40, [color], 3, 9, 0.9, 2, 1 - size * 1.5, 1 - size * 0.6);
    };

    const surfaces = {
        Sun: (g, w, h) => {
            fill(g, w, h, '#ffae34');
            blobs(g, w, h, 500, ['#ffd76a', '#ff9a1f', '#fff0a8', '#f57c0a'], 2, 9, 0.5);
            blobs(g, w, h, 8, ['#a84a05'], 2, 5, 0.7, 1.5, 0.3, 0.7); // sunspots
        },
        Mercury: (g, w, h) => {
            fill(g, w, h, '#8f8881');
            blobs(g, w, h, 160, ['#6f6862', '#a39c94', '#7b746d'], 4, 16, 0.4);
            blobs(g, w, h, 220, ['#5b554f', '#b8b0a7'], 1, 4, 0.55); // craters
        },
        Venus: (g, w, h) => {
            bands(g, w, h, ['#c99a55', '#e3c487', '#f0dcae', '#e6c98d', '#d8b06c', '#eed7a4', '#c99a55']);
            blobs(g, w, h, 90, ['#f6e7c3', '#cfa663', '#e9d2a0'], 4, 12, 0.3, 7); // thick cloud streaks
        },
        Earth: (g, w, h) => {
            bands(g, w, h, ['#123a7a', '#1a56a8', '#1f66bd', '#1a56a8', '#123a7a']);
            blobs(g, w, h, 46, ['#2f7d3a', '#3c8f45', '#5a8f3e'], 10, 30, 0.95, 1.3, 0.2, 0.8); // continents
            blobs(g, w, h, 40, ['#3f8a3f', '#6f8f44'], 4, 12, 0.9, 1.4, 0.18, 0.82);
            blobs(g, w, h, 14, ['#c2a86a', '#b59458'], 5, 13, 0.75, 1.6, 0.34, 0.62); // deserts
            caps(g, w, h, 0.07, '#f4f8fb');
            blobs(g, w, h, 110, ['#ffffff'], 2, 7, 0.38, 6); // clouds
        },
        Moon: (g, w, h) => {
            fill(g, w, h, '#b9b6b0');
            blobs(g, w, h, 30, ['#8d8a86'], 8, 22, 0.5); // maria
            blobs(g, w, h, 120, ['#d6d3cd', '#7f7c78'], 1, 4, 0.5);
        },
        Mars: (g, w, h) => {
            bands(g, w, h, ['#a3472a', '#c0603a', '#cf7146', '#bd5c36', '#9c4226']);
            blobs(g, w, h, 60, ['#7a3520', '#8a3f25'], 8, 26, 0.45, 1.6, 0.2, 0.8); // dark highlands
            blobs(g, w, h, 60, ['#dd9562', '#d18350'], 5, 16, 0.35, 1.5);
            caps(g, w, h, 0.045, '#f3ede6');
        },
        Jupiter: (g, w, h) => {
            bands(g, w, h, ['#8f7a66', '#b89a7a', '#e6d6ba', '#a8714a', '#ecdcc1', '#c69c6e', '#f0e4cc', '#a5653d', '#e8d6b4', '#bb8d64', '#dcc7a5', '#9c7b5d', '#8a7461']);
            blobs(g, w, h, 160, ['#f4e9d3', '#9a6a45', '#d6b98f'], 2, 6, 0.28, 9); // turbulent streaks
            g.fillStyle = '#e2b48c'; g.beginPath(); g.ellipse(w * 0.3, h * 0.64, 36, 19, 0, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#b4472a'; g.beginPath(); g.ellipse(w * 0.3, h * 0.64, 29, 14, 0, 0, Math.PI * 2); g.fill(); // Great Red Spot
            g.fillStyle = '#c96a44'; g.beginPath(); g.ellipse(w * 0.3, h * 0.64, 17, 7, 0, 0, Math.PI * 2); g.fill();
        },
        Saturn: (g, w, h) => {
            bands(g, w, h, ['#b9a06a', '#d9c28c', '#ecdcab', '#d2b97f', '#f0e2b8', '#d8bf88', '#e6d3a0', '#c9ad74', '#b79c66']);
            blobs(g, w, h, 80, ['#f3e8c4', '#c4a86e'], 2, 5, 0.2, 10);
        },
        Uranus: (g, w, h) => {
            bands(g, w, h, ['#8fd6dc', '#a9e6ea', '#b9eef1', '#a6e3e8', '#93d9df']);
            blobs(g, w, h, 30, ['#c9f4f6'], 3, 7, 0.15, 10);
        },
        Neptune: (g, w, h) => {
            bands(g, w, h, ['#2443a8', '#2f58cc', '#3d6fe4', '#3160d4', '#3f74e8', '#2c50c0', '#22409f']);
            blobs(g, w, h, 40, ['#5b8cf2', '#2a49b3'], 2, 6, 0.3, 9);
            g.fillStyle = '#1b3285'; g.beginPath(); g.ellipse(w * 0.62, h * 0.6, 22, 11, 0, 0, Math.PI * 2); g.fill(); // Great Dark Spot
            blobs(g, w, h, 10, ['#e8f1ff'], 1.5, 3, 0.7, 8, 0.5, 0.7);
        },
        Rings: (g, w, h) => {
            for (let x = 0; x < w; x++) {
                const t = x / w;
                let a = t < 0.14 ? 0.22 : t < 0.56 ? 0.92 : t < 0.63 ? 0.04 : t < 0.94 ? 0.7 : 0.25; // C, B, Cassini gap, A, F
                a *= 0.75 + rand() * 0.25;
                const shade = 190 + Math.floor(rand() * 45);
                g.fillStyle = 'rgba(' + shade + ',' + (shade - 18) + ',' + (shade - 58) + ',' + a + ')';
                g.fillRect(x, 0, 1, h);
            }
        }
    };

    // Ring geometry with UVs running radially so the ring texture maps inner -> outer
    const ringGeometry = (inner, outer) => {
        const geo = new THREE.RingGeometry(inner, outer, 128, 1);
        const p = geo.attributes.position, uv = geo.attributes.uv;
        for (let k = 0; k < p.count; k++) {
            uv.setXY(k, (Math.hypot(p.getX(k), p.getY(k)) - inner) / (outer - inner), 0.5);
        }
        return geo;
    };

    // ---------- Starfield ----------
    const starPts = [];
    for (let i = 0; i < 1200; i++) {
        const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(150 + Math.random() * 90);
        starPts.push(v.x, v.y, v.z);
    }
    const starfieldGeo = new THREE.BufferGeometry();
    starfieldGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPts, 3));
    scene.add(new THREE.Points(starfieldGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, fog: false })));

    // ---------- The Sun ----------
    const SUN_R = 2.6;
    const sunGroup = new THREE.Group();
    const sunSurface = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 64, 64), new THREE.MeshBasicMaterial({ color: hasCanvas ? 0xffffff : 0xffc94d, map: paint(surfaces.Sun) }));
    sunGroup.add(sunSurface);
    [[1.25, 0.22, 0xffb347], [1.6, 0.1, 0xff8c1a], [2.2, 0.045, 0xff7b1c]].forEach(([k, opacity, color]) => {
        sunGroup.add(new THREE.Mesh(new THREE.SphereGeometry(SUN_R * k, 32, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })));
    });
    const sunBody = new CANNON.Body({ mass: SUN_MASS, shape: new CANNON.Sphere(SUN_R), linearDamping: 0.5, angularDamping: 0.5 });
    addSimulationObject('Sun', sunGroup, sunBody);
    scene.add(new THREE.PointLight(0xfff1dc, 3.2, 0, 0));

    // ---------- Planets ----------
    // name, orbit radius, display radius, axial tilt (deg), spin (rad/s; tilts above 90 deg give retrograde spin)
    // Display radius = 0.5 * (real radius in Earth radii)^0.45, which keeps the true size ranking.
    const defs = [
        ['Mercury', 5.0, 0.32, 0.03, 0.15],
        ['Venus', 7.0, 0.49, 177.4, 0.06],
        ['Earth', 9.3, 0.50, 23.4, 1.6],
        ['Mars', 11.8, 0.38, 25.2, 1.55],
        ['Jupiter', 17.0, 1.48, 3.1, 3.8],
        ['Saturn', 22.5, 1.37, 26.7, 3.5],
        ['Uranus', 27.5, 0.93, 97.8, 2.2],
        ['Neptune', 32.0, 0.92, 28.3, 2.4]
    ];
    const trailColors = { Mercury: 0x9a938b, Venus: 0xe3c487, Earth: 0x3f8cff, Mars: 0xcf6a40, Jupiter: 0xd8b48a, Saturn: 0xe6d3a0, Uranus: 0x9fe3e6, Neptune: 0x3f74e8 };

    const TRAIL = 220;
    const orbiters = [];
    const spinners = [{ mesh: sunSurface, rate: 0.08 }];
    const trails = [];
    let moonPivot = null;

    const addTrail = (body, colorHex, brightness) => {
        const pos = new Float32Array(TRAIL * 3);
        const col = new Float32Array(TRAIL * 3);
        const c = new THREE.Color(colorHex);
        for (let k = 0; k < TRAIL; k++) {
            pos[k * 3] = body.position.x; pos[k * 3 + 1] = body.position.y; pos[k * 3 + 2] = body.position.z;
            const f = Math.pow(k / (TRAIL - 1), 2) * brightness;
            col[k * 3] = c.r * f; col[k * 3 + 1] = c.g * f; col[k * 3 + 2] = c.b * f;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        line.frustumCulled = false;
        scene.add(line);
        trails.push({ body, pos, geo });
    };

    const makeOrbitBody = (r, angle, radius, speedFactor) => {
        const v = Math.sqrt(G * SUN_MASS / r) * speedFactor;
        const body = new CANNON.Body({
            mass: 1,
            shape: new CANNON.Sphere(radius),
            position: new CANNON.Vec3(r * Math.cos(angle), 0, r * Math.sin(angle)),
            linearDamping: 0,
            angularDamping: 0
        });
        body.fixedRotation = true; // Spin is visual, so the axial tilt stays fixed in space
        body.updateMassProperties();
        // Orbiters collide with the Sun only, never with each other
        body.collisionFilterGroup = 2;
        body.collisionFilterMask = 1;
        body.velocity.set(-v * Math.sin(angle), 0, v * Math.cos(angle));
        return body;
    };

    defs.forEach((d, i) => {
        const name = d[0], r = d[1], radius = d[2], tilt = d[3], spin = d[4];
        const body = makeOrbitBody(r, i * 2.4, radius, 1);

        const planet = new THREE.Group();
        const axis = new THREE.Group(); // Carries the axial tilt
        axis.rotation.z = tilt * DEG;
        planet.add(axis);

        const map = paint(surfaces[name]);
        const globe = new THREE.Mesh(
            new THREE.SphereGeometry(radius, 64, 48),
            new THREE.MeshStandardMaterial({ color: map ? 0xffffff : trailColors[name], map, roughness: 0.95, metalness: 0 })
        );
        axis.add(globe);
        spinners.push({ mesh: globe, rate: spin });

        if (name === 'Earth') {
            // Thin atmosphere glow
            axis.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.06, 32, 32), new THREE.MeshBasicMaterial({ color: 0x6fb7ff, transparent: true, opacity: 0.13, depthWrite: false })));
            moonPivot = new THREE.Group();
            const moon = new THREE.Mesh(new THREE.SphereGeometry(0.135, 24, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, map: paint(surfaces.Moon, 256, 128), roughness: 1 }));
            moon.position.set(1.15, 0, 0);
            moonPivot.rotation.z = 5.1 * DEG;
            moonPivot.add(moon);
            planet.add(moonPivot);
        }
        if (name === 'Saturn') {
            const ringMap = paint(surfaces.Rings, 256, 4);
            const rings = new THREE.Mesh(ringGeometry(radius * 1.24, radius * 2.3), new THREE.MeshBasicMaterial({ color: ringMap ? 0xffffff : 0xdcc79a, map: ringMap, side: THREE.DoubleSide, transparent: true, opacity: ringMap ? 0.95 : 0.5, depthWrite: false }));
            rings.rotation.x = Math.PI / 2;
            axis.add(rings);
        }
        if (name === 'Uranus') {
            const rings = new THREE.Mesh(ringGeometry(radius * 1.55, radius * 1.68), new THREE.MeshBasicMaterial({ color: 0xbfeff2, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false }));
            rings.rotation.x = Math.PI / 2;
            axis.add(rings);
        }

        addSimulationObject('planet_' + name, planet, body);
        orbiters.push(body);
        addTrail(body, trailColors[name], 0.55);
    });

    // ---------- Asteroid belt (between Mars and Jupiter) ----------
    const beltPts = [];
    for (let i = 0; i < 900; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 13.4 + Math.random() * 1.9;
        beltPts.push(r * Math.cos(a), (Math.random() - 0.5) * 0.5, r * Math.sin(a));
    }
    const beltGeo = new THREE.BufferGeometry();
    beltGeo.setAttribute('position', new THREE.Float32BufferAttribute(beltPts, 3));
    const belt = new THREE.Points(beltGeo, new THREE.PointsMaterial({ color: 0x9a8f80, size: 0.13, fog: false }));
    scene.add(belt);

    // ---------- Comet on an eccentric orbit, tail always pointing away from the Sun ----------
    const cometBody = makeOrbitBody(25, 4.0, 0.16, 0.62);
    const comet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), new THREE.MeshBasicMaterial({ color: 0xe8f6ff }));
    addSimulationObject('planet_Comet', comet, cometBody);
    orbiters.push(cometBody);
    addTrail(cometBody, 0x9fd8ff, 0.35);

    const tailGeo = new THREE.ConeGeometry(0.35, 1, 16, 1, true);
    tailGeo.rotateX(Math.PI);
    tailGeo.translate(0, 0.5, 0); // Tip at the comet, widening outward
    const tail = new THREE.Mesh(tailGeo, new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    scene.add(tail);

    // ---------- Gravity ----------
    world.addEventListener('preStep', () => {
        if (!sunBody.world) return; // Scene was rebuilt; this listener is stale
        const M = sunBody.mass;
        orbiters.forEach(p => {
            const dx = sunBody.position.x - p.position.x;
            const dy = sunBody.position.y - p.position.y;
            const dz = sunBody.position.z - p.position.z;
            const d2 = Math.max(dx * dx + dy * dy + dz * dz, 4);
            const d = Math.sqrt(d2);
            const f = G * M * p.mass / d2;
            p.force.x += f * dx / d;
            p.force.y += f * dy / d;
            p.force.z += f * dz / d;
        });
    });

    // ---------- Per-frame visuals ----------
    const up = new THREE.Vector3(0, 1, 0);
    const away = new THREE.Vector3();
    let tick = 0;
    const updateVisuals = () => {
        spinners.forEach(s => { s.mesh.rotation.y += s.rate / 60; });
        if (moonPivot) moonPivot.rotation.y += 1.4 / 60;
        belt.rotation.y -= 0.02 / 60;

        away.set(cometBody.position.x - sunBody.position.x, cometBody.position.y - sunBody.position.y, cometBody.position.z - sunBody.position.z);
        const dist = Math.max(away.length(), 0.001);
        tail.position.set(cometBody.position.x, cometBody.position.y, cometBody.position.z);
        tail.quaternion.setFromUnitVectors(up, away.divideScalar(dist));
        tail.scale.set(1, Math.min(Math.max(45 / dist, 1), 7), 1); // Tail grows near the Sun

        if (tick++ % 2 !== 0) return;
        trails.forEach(t => {
            t.pos.copyWithin(0, 3);
            const o = (TRAIL - 1) * 3;
            t.pos[o] = t.body.position.x; t.pos[o + 1] = t.body.position.y; t.pos[o + 2] = t.body.position.z;
            t.geo.attributes.position.needsUpdate = true;
        });
    };
    updateVisuals();
    addFrameCallback(updateVisuals);
  `,
  sliders: [
    { label: "Sun Mass", targetLabel: "Sun", property: "mass", min: 200, max: 3000, value: 1000, step: 50 },
    { label: "Planet Mass", targetLabel: "planet", property: "mass", min: 0.2, max: 10, value: 1, step: 0.2 },
    { label: "Orbital Drag", targetLabel: "planet", property: "damping", min: 0, max: 0.2, value: 0, step: 0.005 },
    { label: "Time Scale", targetLabel: "world", property: "scale", min: 0.1, max: 2.0, value: 1.0, step: 0.1 }
  ]
};
