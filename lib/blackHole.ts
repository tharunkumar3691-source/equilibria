import { SimulationData } from '../types';

// Black Hole demo: a 10 solar-mass, non-spinning black hole feeding on asteroids, a moonlet, a comet
// and a neutron star. Gravity uses the Paczynski-Wiita potential, a = GM / (r - r_s)^2, which reproduces
// the two orbits that matter most in general relativity: the innermost stable orbit at 3 r_s and the
// plunge inside it. Speeds are capped at the speed of light.
// Sizes and distances are true to scale (1 unit = 14.8 km); time runs about 850 times slower than real.
// The look is drawn with custom shaders: the shadow and photon ring, an accretion disk with the real
// temperature profile, Doppler beaming and gravitational redshift, and thin-lens gravitational lensing
// of the starfield (Einstein ring) and of the disk's far side (the arc over and under the shadow).
export const BLACK_HOLE: SimulationData = {
  demoMode: true,
  startMode: 'auto',
  thought_process: "ANALYSIS COMPLETE.\n\nScenario: A black hole of 10 solar masses (non-spinning) feeding on a swarm of asteroids, a moonlet, a comet and a neutron star.\n\nWhat a black hole is:\n- So much mass in so little space that the escape speed reaches the speed of light. Inside the event horizon (radius r_s = 2GM/c^2, 29.5 km here) every path, even light's, leads inward. Nothing that crosses it ever comes back.\n- The black disc is the hole's shadow, 2.6 times wider than the horizon: light passing closer than that is bent in and captured. The thin bright ring around it is light that circled the hole before escaping (the photon sphere, 1.5 r_s).\n- Gravity bends light from behind it: the stars near the hole are smeared into an Einstein ring, and the far side of the glowing disk is lifted into view over the top of the shadow.\n\nWhat you see happen:\n- Near the hole, orbits are no longer closed ellipses: the neutron star's closest point swings round on every orbit (relativistic precession). Inside 3 r_s (the innermost stable orbit, 89 km) no orbit survives; anything there plunges in.\n- Infalling objects speed up towards the speed of light, are stretched along the fall line by tidal forces (spaghettification), and redden and dim as their light climbs out of the hole's gravity (gravitational redshift). Time itself runs slower there: see the readout.\n- The accretion disk is gas orbiting at up to about half the speed of light, heated to millions of degrees. The side moving towards you looks brighter and bluer (relativistic Doppler beaming).\n- Swallow the neutron star and the hole gains 1.4 solar masses: its horizon grows.\n\nTry it: click an object to brake it and watch it fall; drag one towards the hole; raise the mass; add gas drag to make everything spiral in.\n\nScale note: sizes and distances are real (1 unit = 14.8 km), but time runs about 850 times slower so the motion can be followed. The disk's colours are as the eye would see them; the real inner disk of a stellar black hole is so hot it shines mostly in X-rays.",
  code: `
    world.gravity.set(0, -1e-9, 0); // Space. Not exactly zero: see GRAVITY below
    world.allowSleep = false;
    setAmbience('space');
    if (scene.fog) { scene.fog.near = 500; scene.fog.far = 900; }
    scene.background = new THREE.Color(0x000000);
    camera.position.set(0, 8, 40);
    camera.userData.lookAt = [0, 0, 0];

    // The only light is the hot gas around the hole: mute the studio lights
    scene.children.forEach(o => {
        if (o.isDirectionalLight) o.intensity = 0;
        if (o.isAmbientLight) o.intensity = 0.05;
        if (o.isHemisphereLight) o.intensity = 0;
    });
    scene.add(new THREE.PointLight(0xffe2c0, 2.2, 0, 0));

    // ---------- Units ----------
    const C = 24;                   // Speed of light, in scene units per second
    const RS_PER_SUN = 0.2;         // Horizon radius per solar mass, in scene units
    const KM = 2.953 / RS_PER_SUN;  // Kilometres per scene unit (the real horizon is 2.953 km per solar mass)
    const SLOWDOWN = 299792.458 / (C * KM);
    const SHADOW = 2.598;           // The shadow's radius in horizon radii (3 times the square root of 3, halved)
    const noRaycast = () => {};

    // ---------- The black hole ----------
    // A fixed body: it holds the hole's mass (in solar masses, set by the mass slider) and never moves
    const holeBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, shape: new CANNON.Sphere(0.5) });
    holeBody.collisionFilterGroup = 0;
    holeBody.collisionFilterMask = 0;
    holeBody.mass = 10;
    const hole = new THREE.Group();

    // The shadow: a black sphere looks the same from every side
    const shadow = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    shadow.frustumCulled = false;
    shadow.renderOrder = -1;
    hole.add(shadow);

    // Photon ring: light that orbited the hole before escaping, brighter on the side whose gas moves towards you
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        uniforms: { uRadius: { value: 1 } },
        vertexShader: [
            'uniform float uRadius;',
            'varying vec2 vP;',
            'varying vec3 vAxis;',
            'void main() {',
            '  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
            '  float D = length(c.xyz);',
            '  float k = max(D - uRadius, 0.1) / D;',   // Drawn just in front of the shadow, at the same apparent size
            '  vec3 cc = c.xyz * k;',
            '  vP = position.xy * 1.6;',
            '  cc.xy += vP * uRadius * k;',
            '  vAxis = normalize((viewMatrix * vec4(0.0, -1.0, 0.0, 0.0)).xyz);',
            '  gl_Position = projectionMatrix * vec4(cc, 1.0);',
            '}'
        ].join('\\n'),
        fragmentShader: [
            'varying vec2 vP;',
            'varying vec3 vAxis;',
            'void main() {',
            '  float r = length(vP);',
            '  float ring = exp(-pow((r - 1.0) / 0.022, 2.0));',
            '  float halo = r > 1.0 ? exp(-(r - 1.0) * 6.0) * 0.16 : 0.0;',
            '  vec3 v = cross(vAxis, vec3(vP, 0.0));',
            '  float los = length(v) > 1e-4 ? normalize(v).z : 0.0;',
            '  vec3 col = (vec3(1.0, 0.82, 0.6) * ring * 1.8 + vec3(1.0, 0.58, 0.28) * halo) * (1.0 + 0.6 * los);',
            '  gl_FragColor = vec4(col, 1.0);',
            '  #include <tonemapping_fragment>',
            '  #include <colorspace_fragment>',
            '}'
        ].join('\\n'),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    ring.frustumCulled = false;
    ring.renderOrder = 3;
    ring.raycast = noRaycast;
    ring.isLine2 = true; // Kept out of the ambient-occlusion pass, which would draw it as a flat square
    hole.add(ring);

    // Accretion disk, from just inside the innermost stable orbit (3 r_s) out to 10 r_s. The geometry is
    // in horizon radii and scaled by the horizon, so the disk grows with the hole.
    const disk = new THREE.Mesh(new THREE.RingGeometry(2.2, 10, 360, 64), new THREE.ShaderMaterial({
        uniforms: { uRs: { value: 2 }, uTime: { value: 0 }, uC: { value: C } },
        vertexShader: [
            'uniform float uRs;',
            'varying vec3 vWorld;',
            'void main() {',
            '  vec4 world = modelMatrix * vec4(position, 1.0);',
            '  vWorld = world.xyz;',
            '  vec3 P = (viewMatrix * world).xyz;',
            '  vec3 B = (viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
            '  float dl = length(B);',
            '  vec3 b = B / dl;',
            // Gas behind the hole is seen where its light is bent: the thin-lens image, pushed away from the hole
            '  float behind = dot(P, b) - dl;',
            '  if (behind > 0.0) {',
            '    float ds = length(P);',
            '    vec3 s = P / ds;',
            '    float cosT = clamp(dot(s, b), -1.0, 1.0);',
            '    float theta = acos(cosT);',
            '    float thetaE2 = 2.0 * uRs * behind / (dl * (dl + behind));',
            '    float img = 0.5 * (theta + sqrt(theta * theta + 4.0 * thetaE2));',
            '    vec3 perp = s - b * cosT;',
            '    float pl = length(perp);',
            '    if (pl > 1e-5) P = (b * cos(img) + perp / pl * sin(img)) * ds;',
            '  }',
            '  gl_Position = projectionMatrix * vec4(P, 1.0);',
            '}'
        ].join('\\n'),
        fragmentShader: [
            'uniform float uRs;',
            'uniform float uTime;',
            'uniform float uC;',
            'varying vec3 vWorld;',
            'float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
            'float noise(vec3 x) {',
            '  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);',
            '  return mix(mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),',
            '             mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);',
            '}',
            'float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return v; }',
            'vec3 blackbody(float k) {',
            '  float t = clamp(k, 1000.0, 40000.0) / 100.0;',
            '  float r = t <= 66.0 ? 1.0 : clamp(1.29293618 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);',
            '  float g = t <= 66.0 ? clamp(0.39008157876 * log(t) - 0.63184144378, 0.0, 1.0) : clamp(1.12989086 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);',
            '  float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.54320678911 * log(t - 10.0) - 1.19625408914, 0.0, 1.0));',
            '  return pow(vec3(r, g, b), vec3(2.2));',
            '}',
            // Clumps of gas carried round at the local orbital speed (inner gas laps outer gas, shearing them into
            // streaks). Two copies a half-period apart are cross-faded so the shear never piles up.
            'float gas(float R, float phi, float omega, float t, float seed) {',
            '  float ph = phi - omega * t;',
            '  return fbm(vec3(cos(ph) * 2.2, sin(ph) * 2.2, R * 2.4 + seed));',
            '}',
            'void main() {',
            '  float R = length(vWorld.xz) / uRs;',
            '  float phi = atan(vWorld.z, vWorld.x);',
            '  float beta = min(sqrt(0.5 * R) / max(R - 1.0, 0.05), 0.75);',   // Orbital speed over c
            '  float omega = beta * uC / (R * uRs);',
            // Thin-disk temperature: zero at the innermost stable orbit, hottest at 4.1 r_s, cooling outward
            '  float tn = R > 3.0 ? pow(R, -0.75) * pow(1.0 - sqrt(3.0 / R), 0.25) / 0.2138 : 0.3 * smoothstep(2.2, 3.0, R);',
            '  float period = 4.0;',
            '  float t1 = mod(uTime, period);',
            '  float t2 = mod(uTime + 0.5 * period, period);',
            '  float w1 = 1.0 - abs(2.0 * t1 / period - 1.0);',
            '  float f = gas(R, phi, omega, t1, 0.0) * w1 + gas(R, phi, omega, t2, 17.3) * (1.0 - w1);',
            '  float turb = 0.25 + 1.4 * smoothstep(0.28, 0.78, f);',
            // Relativistic Doppler shift and beaming, and gravitational redshift
            '  vec3 vdir = normalize(vec3(-vWorld.z, 0.0, vWorld.x));',
            '  vec3 n = normalize(cameraPosition - vWorld);',
            '  float gamma = inversesqrt(1.0 - beta * beta);',
            '  float delta = 1.0 / (gamma * (1.0 - beta * dot(vdir, n)));',
            '  float g = delta * sqrt(max(1.0 - 1.0 / R, 0.0));',
            // Seen brightness goes as g^4: the approaching side outshines the receding one many times over
            '  vec3 col = blackbody(6500.0 * tn * g);',
            '  float intensity = min(0.9 * pow(tn, 3.0) * pow(g, 4.0), 6.0) * turb * smoothstep(10.0, 6.5, R);',
            '  gl_FragColor = vec4(col * intensity, 1.0);',
            '  #include <tonemapping_fragment>',
            '  #include <colorspace_fragment>',
            '}'
        ].join('\\n'),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    disk.rotation.x = -Math.PI / 2;
    disk.frustumCulled = false;
    disk.renderOrder = 2;
    disk.raycast = noRaycast;
    disk.isLine2 = true; // Kept out of the ambient-occlusion pass (it would darken the disk with its own flat shape)
    hole.add(disk);

    addSimulationObject('BlackHole', hole, holeBody, { sound: 'soft' });

    // ---------- Stars, lensed by the hole ----------
    // Every star is drawn twice: the primary image pushed away from the hole, and the faint secondary image
    // on the opposite side, inside the Einstein ring. Each is as bright as the lens magnifies it.
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const STARS = 6000;
    const starPos = new Float32Array(STARS * 3), starCol = new Float32Array(STARS * 3), starSize = new Float32Array(STARS);
    const palette = [[0.62, 0.72, 1.0], [0.8, 0.86, 1.0], [1.0, 1.0, 1.0], [1.0, 0.94, 0.82], [1.0, 0.82, 0.6], [1.0, 0.7, 0.5]];
    const band = new THREE.Vector3(0.3, 1, 0.45).normalize();   // Pole of the Milky Way's band
    const bandA = new THREE.Vector3(1, 0, 0).cross(band).normalize(), bandB = band.clone().cross(bandA);
    const v = new THREE.Vector3();
    for (let i = 0; i < STARS; i++) {
        if (rand() < 0.45) {
            const a = rand() * Math.PI * 2, lat = (rand() + rand() + rand() - 1.5) * 0.18;
            v.copy(bandA).multiplyScalar(Math.cos(a)).addScaledVector(bandB, Math.sin(a)).addScaledVector(band, lat).normalize();
        } else {
            v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
            if (v.lengthSq() > 1 || v.lengthSq() < 1e-4) { i--; continue; }
            v.normalize();
        }
        v.multiplyScalar(300 + rand() * 120);
        starPos.set([v.x, v.y, v.z], i * 3);
        const c = palette[Math.floor(rand() * palette.length)];
        const bright = 0.25 + Math.pow(rand(), 6) * 1.6;
        starCol.set([c[0] * bright, c[1] * bright, c[2] * bright], i * 3);
        starSize[i] = 1.4 + Math.pow(rand(), 8) * 3.5;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeometry.setAttribute('aColor', new THREE.BufferAttribute(starCol, 3));
    starGeometry.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
    const pixelRatio = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    const starMaterials = [1, -1].map(sign => new THREE.ShaderMaterial({
        uniforms: { uRs: { value: 2 }, uSign: { value: sign }, uScale: { value: pixelRatio } },
        vertexShader: [
            'uniform float uRs;',
            'uniform float uSign;',
            'uniform float uScale;',
            'attribute float aSize;',
            'attribute vec3 aColor;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'void main() {',
            '  vec3 B = (viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
            '  vec3 S = (modelViewMatrix * vec4(position, 1.0)).xyz;',
            '  float dl = length(B);',
            '  float ds = length(S);',
            '  vec3 b = B / dl;',
            '  vec3 s = S / ds;',
            '  float cosT = clamp(dot(b, s), -1.0, 1.0);',
            '  float theta = max(acos(cosT), 1e-4);',
            '  float thetaE = sqrt(2.0 * uRs * max(ds - dl, 0.0) / (dl * ds));',   // Einstein radius
            '  float root = sqrt(theta * theta + 4.0 * thetaE * thetaE);',
            '  float u = theta / max(thetaE, 1e-6);',
            '  float base = (u * u + 2.0) / (2.0 * u * sqrt(u * u + 4.0));',
            '  float img = uSign > 0.0 ? 0.5 * (theta + root) : 0.5 * (root - theta);',
            '  float mag = uSign > 0.0 ? base + 0.5 : base - 0.5;',
            '  vec3 perp = s - b * cosT;',
            '  float pl = length(perp);',
            '  perp = pl > 1e-6 ? perp / pl : vec3(0.0, 1.0, 0.0);',
            '  if (uSign < 0.0) perp = -perp;',
            '  vec3 dir = b * cos(img) + perp * sin(img);',
            '  vAlpha = clamp(mag, 0.0, 4.0);',
            '  if (img < asin(min(2.598 * uRs / dl, 1.0))) vAlpha = 0.0;',   // Light aimed into the shadow is captured
            '  vColor = aColor;',
            '  gl_Position = projectionMatrix * vec4(dir * ds, 1.0);',
            '  gl_PointSize = aSize * uScale * clamp(sqrt(mag), 0.6, 2.2);',
            '}'
        ].join('\\n'),
        fragmentShader: [
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'void main() {',
            '  float d = length(gl_PointCoord - 0.5);',
            '  float a = smoothstep(0.5, 0.0, d) * vAlpha;',
            '  if (a < 0.003) discard;',
            '  gl_FragColor = vec4(vColor * a, 1.0);',
            '  #include <tonemapping_fragment>',
            '  #include <colorspace_fragment>',
            '}'
        ].join('\\n'),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    starMaterials.forEach(material => {
        const stars = new THREE.Points(starGeometry, material);
        stars.frustumCulled = false;
        stars.renderOrder = -2;
        scene.add(stars);
    });

    // ---------- Debris: everything here is true to scale ----------
    // A rock: a sphere pushed in and out by a fixed pattern of bumps and hollows (the same for every vertex
    // at the same place, so the seam never cracks)
    const rockGeometry = (radius, rockSeed, stretch) => {
        const g = new THREE.SphereGeometry(radius, 64, 48);
        const p = g.attributes.position;
        let s = rockSeed;
        const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
        const bumps = [];
        for (let i = 0; i < 14; i++) {
            bumps.push({ d: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), h: (rnd() - 0.55) * 0.5, w: 0.15 + rnd() * 0.5 });
        }
        const n = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) {
            n.fromBufferAttribute(p, i).normalize();
            let k = 1 + 0.035 * Math.sin(n.x * 9.1 + n.y * 4.3) * Math.sin(n.z * 7.7 - n.x * 3.1);
            bumps.forEach(b => {
                const t = n.dot(b.d);
                if (t > 1 - b.w) k += b.h * Math.pow((t - (1 - b.w)) / b.w, 2);
            });
            p.setXYZ(i, n.x * radius * k * stretch[0], n.y * radius * k * stretch[1], n.z * radius * k * stretch[2]);
        }
        g.computeVertexNormals();
        return g;
    };

    // Each object: a holder that follows the body, a stretch group for tidal stretching, and the model
    const debris = [];
    const makeDebris = (label, name, model, radius, orbit, extra) => {
        const holder = new THREE.Group();
        const stretch = new THREE.Group();
        holder.add(stretch);
        stretch.add(model);
        const body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(radius), linearDamping: 0, angularDamping: 0 });
        body.collisionFilterGroup = 0; // Nothing collides: in space, gravity is what matters here
        body.collisionFilterMask = 0;
        // Start position and velocity from the orbit: radius, angle, tilt, share of the circular speed, radial speed
        const r0 = orbit[0], phase = orbit[1], tilt = orbit[2], share = orbit[3], vr = orbit[4];
        const rs = RS_PER_SUN * holeBody.mass, GM = 0.5 * C * C * rs;
        const vt = Math.sqrt(GM * r0) / (r0 - rs) * share;
        const tilted = (x, z) => new THREE.Vector3(x, -z * Math.sin(tilt), z * Math.cos(tilt));
        const pos = tilted(r0 * Math.cos(phase), r0 * Math.sin(phase));
        const tangent = tilted(-Math.sin(phase), Math.cos(phase));
        const radial = tilted(Math.cos(phase), Math.sin(phase));
        body.position.set(pos.x, pos.y, pos.z);
        body.velocity.set(tangent.x * vt + radial.x * vr, tangent.y * vt + radial.y * vr, tangent.z * vt + radial.z * vr);
        body.angularVelocity.set((rand() - 0.5) * 1.2, (rand() - 0.5) * 1.2, (rand() - 0.5) * 1.2);
        // Base colours, for the gravitational redshift
        const tints = [];
        model.traverse(o => {
            if (!o.material || !o.material.color) return;
            tints.push({ m: o.material, color: o.material.color.clone(), glow: o.material.emissiveIntensity || 0 });
        });
        addSimulationObject('debris_' + label, holder, body, { sound: 'stone' });
        const d = Object.assign({ label: 'debris_' + label, name, holder, stretch, model, body, radius, tints, solarMass: 0, last: pos.clone(), hidden: false }, extra || {});
        debris.push(d);
        return d;
    };

    const rock = (label, name, radius, rockSeed, color, stretch, orbit) => {
        const model = new THREE.Mesh(rockGeometry(radius, rockSeed, stretch), realMaterial('stone', { color, size: radius * 2 }));
        return makeDebris(label, name, model, radius, orbit);
    };

    // Orbits: [radius, angle, tilt, share of circular speed, radial speed]. Worked out ahead: two rocks and the
    // moonlet circle safely, a rock, the comet and the neutron star swing in on precessing ellipses, and two
    // rocks have too little sideways speed and fall in (the first after about 3 s, the second after about 12 s).
    rock('Moonlet', 'Moonlet', 1.0, 11, 0x8a8178, [1.35, 0.9, 1.0], [19, 2.3, 0.12, 1.0, 0]);
    rock('RockA', 'Asteroid A', 0.55, 23, 0x8d8780, [1.2, 1, 0.9], [12, 4.1, -0.18, 1.0, 0]);
    rock('RockB', 'Asteroid B', 0.65, 37, 0x7a6a5a, [1, 0.85, 1.25], [15.5, 1.2, 0.03, 1.0, 0]);
    rock('RockC', 'Asteroid C', 0.5, 41, 0x6f6a64, [1.3, 1, 1], [20, 5.2, 0.22, 0.84, 0]);
    rock('RockD', 'Asteroid D', 0.6, 53, 0x9a8a78, [1, 1.2, 0.9], [17, 3.3, -0.1, 0.30, 0]);
    rock('RockE', 'Asteroid E', 0.45, 67, 0x807870, [1.25, 0.9, 1], [18, 0.9, 0.15, 0.40, 5.0]);

    // Comet: a dark icy nucleus in a glowing coma; its tail is drawn separately, always pointing away from the hole
    const cometModel = new THREE.Group();
    cometModel.add(new THREE.Mesh(rockGeometry(0.45, 79, [1.3, 0.9, 1]), realMaterial('stone', { color: 0x4a4540, size: 0.9 })));
    [[1.0, 0.22], [1.8, 0.09]].forEach(([r, opacity]) => {
        const coma = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
        coma.raycast = noRaycast;
        cometModel.add(coma);
    });
    const comet = makeDebris('Comet', 'Comet', cometModel, 0.45, [20, 5.9, -0.3, 0.80, 2.0]);
    const tailGeometry = new THREE.ConeGeometry(0.9, 1, 24, 1, true);
    tailGeometry.rotateX(Math.PI);
    tailGeometry.translate(0, 0.5, 0);
    const tail = new THREE.Mesh(tailGeometry, new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    tail.raycast = noRaycast;
    tail.isLine2 = true;
    scene.add(tail);

    // Neutron star: 1.4 solar masses in a ball 24 km across, spinning, with its two radio beams sweeping round
    const starModel = new THREE.Group();
    starModel.add(new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 32), new THREE.MeshStandardMaterial({ color: 0xcfe3ff, emissive: 0xbcd6ff, emissiveIntensity: 2.6, roughness: 0.3 })));
    const nsGlow = new THREE.Mesh(new THREE.SphereGeometry(1.5, 32, 16), new THREE.MeshBasicMaterial({ color: 0x8fb8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    nsGlow.raycast = noRaycast;
    starModel.add(nsGlow);
    const beams = new THREE.Group();
    beams.rotation.z = 25 * Math.PI / 180; // The magnetic axis is tilted from the spin axis
    [0, Math.PI].forEach(turn => {
        const g = new THREE.ConeGeometry(0.55, 5, 24, 1, true);
        g.rotateX(Math.PI);
        g.translate(0, 2.5, 0);
        const beam = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xa8c8ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
        beam.rotation.z = turn;
        beam.raycast = noRaycast;
        beam.isLine2 = true;
        beams.add(beam);
    });
    starModel.add(beams);
    const neutronStar = makeDebris('NeutronStar', 'Neutron star', starModel, 0.8, [21, 0.4, 0.05, 0.80, 0], { solarMass: 1.4 });
    neutronStar.body.angularVelocity.set(0, 5, 0);

    // ---------- Trails ----------
    const TRAIL = 260;
    const trailColors = { debris_Moonlet: 0xb8aa98, debris_RockA: 0xd8b08a, debris_RockB: 0xc0a080, debris_RockC: 0xa89070, debris_RockD: 0xff9a6a, debris_RockE: 0xffb070, debris_Comet: 0x9fe8ff, debris_NeutronStar: 0x9cc8ff };
    debris.forEach(d => {
        const pos = new Float32Array(TRAIL * 3), col = new Float32Array(TRAIL * 3);
        const c = new THREE.Color(trailColors[d.label] || 0xffffff);
        for (let k = 0; k < TRAIL; k++) {
            pos.set([d.body.position.x, d.body.position.y, d.body.position.z], k * 3);
            const f = Math.pow(k / (TRAIL - 1), 2) * 0.5;
            col.set([c.r * f, c.g * f, c.b * f], k * 3);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        line.frustumCulled = false;
        scene.add(line);
        d.trail = { pos, geometry };
    });

    // ---------- Mass and horizon ----------
    // Whatever crossed the horizon is held at the centre, and its mass is the hole's now
    const eatenMass = () => debris.reduce((m, d) => m + (d.body.position.lengthSquared() < 1e-8 ? d.solarMass : 0), 0);
    const totalMass = () => holeBody.mass + eatenMass();
    const horizon = () => RS_PER_SUN * totalMass();

    // ---------- GRAVITY ----------
    // Paczynski-Wiita gravity, a = GM / (r - r_s)^2, with GM = c^2 r_s / 2. Speeds never pass the speed of light.
    // The app switches gravity off entirely while you drag something with time paused: the tiny world gravity
    // set above is how this code tells, so nothing drifts while you drag.
    world.addEventListener('preStep', () => {
        if (!holeBody.world) return; // The scene was rebuilt: this listener is stale
        const live = world.gravity.y !== 0;
        const rs = horizon();
        const GM = 0.5 * C * C * rs;
        const dt = world.dt > 0 ? world.dt : 1 / 60;
        debris.forEach(d => {
            const b = d.body, p = b.position;
            const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
            if (r < rs) {
                // Crossed the event horizon: gone for good
                p.set(0, 0, 0);
                b.velocity.set(0, 0, 0);
                b.angularVelocity.set(0, 0, 0);
                return;
            }
            if (!live) return;
            const gap = Math.max(r - rs, 0.02 * rs);
            const a = GM / (gap * gap);
            let vx = b.velocity.x - a * p.x / r * dt, vy = b.velocity.y - a * p.y / r * dt, vz = b.velocity.z - a * p.z / r * dt;
            const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (speed > 0.999 * C) { const k = 0.999 * C / speed; vx *= k; vy *= k; vz *= k; }
            b.force.x += (vx - b.velocity.x) / dt * b.mass;
            b.force.y += (vy - b.velocity.y) / dt * b.mass;
            b.force.z += (vz - b.velocity.z) / dt * b.mass;
        });
    });

    // Click an object to brake it: losing orbital speed drops it towards the hole
    addClickCallback(label => {
        const d = debris.find(x => x.label === label);
        if (d) { d.body.velocity.scale(0.45, d.body.velocity); return true; }
        return label === 'BlackHole';
    });

    // ---------- Visuals, worked out afresh from the physics each time a frame is drawn ----------
    const qBody = new THREE.Quaternion(), qRadial = new THREE.Quaternion(), qInverse = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1), yAxis = new THREE.Vector3(0, 1, 0), toHole = new THREE.Vector3();
    const fmt = (n, digits) => n.toFixed(digits);
    const syncVisuals = () => {
        const M = totalMass(), rs = RS_PER_SUN * M;
        shadow.scale.setScalar(SHADOW * rs);
        ring.material.uniforms.uRadius.value = SHADOW * rs;
        disk.scale.setScalar(rs);
        disk.material.uniforms.uRs.value = rs;
        disk.material.uniforms.uTime.value = world.time;
        starMaterials.forEach(m => { m.uniforms.uRs.value = rs; });

        let nearest = null, swallowed = 0;
        debris.forEach(d => {
            const p = d.body.position;
            const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
            const inside = r < rs;
            d.holder.visible = !inside;
            if (inside !== d.hidden) {
                d.hidden = inside;
                d.model.traverse(o => { if (o.isMesh) o.raycast = inside ? noRaycast : THREE.Mesh.prototype.raycast; });
            }
            if (inside) { swallowed++; return; }
            if (!nearest || r < nearest.r) nearest = { d, r };

            // Spaghettification: stretched along the line to the hole, squeezed across it
            const s = Math.min(1 + 12 * Math.pow(rs / r, 3), 3.5);
            toHole.set(-p.x / r, -p.y / r, -p.z / r);
            qRadial.setFromUnitVectors(zAxis, toHole);
            qBody.copy(d.holder.quaternion);
            d.stretch.quaternion.copy(qInverse.copy(qBody).invert()).multiply(qRadial);
            d.stretch.scale.set(1 / Math.sqrt(s), 1 / Math.sqrt(s), s);
            d.model.quaternion.copy(qInverse.copy(qRadial).invert()).multiply(qBody);

            // Gravitational redshift: light climbing out loses energy, so the object reddens and dims
            const g = Math.sqrt(Math.max(0, 1 - rs / r));
            d.tints.forEach(t => {
                t.m.color.setRGB(t.color.r * Math.pow(g, 0.5), t.color.g * Math.pow(g, 1.5), t.color.b * Math.pow(g, 3));
                if (t.glow) t.m.emissiveIntensity = t.glow * Math.pow(g, 4);
            });
            d.holder.updateMatrixWorld(true);
        });

        // The comet's tail points away from the hole and grows as it comes closer
        const cp = comet.body.position, cr = cp.length();
        tail.visible = cr >= rs;
        if (tail.visible) {
            tail.position.set(cp.x, cp.y, cp.z);
            tail.quaternion.setFromUnitVectors(yAxis, toHole.set(cp.x / cr, cp.y / cr, cp.z / cr));
            tail.scale.set(1, Math.min(2 + 60 / cr, 9), 1);
        }

        const rows = [
            ['Mass', fmt(M, 1) + ' solar masses'],
            ['Event horizon radius', fmt(rs * KM, 1) + ' km'],
            ['Innermost stable orbit', fmt(3 * rs * KM, 0) + ' km']
        ];
        if (nearest) {
            const b = nearest.d.body, beta = b.velocity.length() / C;
            rows.push([nearest.d.name + ' (nearest)', fmt(nearest.r * KM, 0) + ' km, ' + fmt(beta, 2) + ' c']);
            rows.push(['Its clock / escape speed', fmt(100 * Math.sqrt(1 - rs / nearest.r), 0) + '% / ' + fmt(Math.sqrt(rs / nearest.r), 2) + ' c']);
        }
        rows.push(['Swallowed', swallowed + ' of ' + debris.length]);
        rows.push('Time runs ' + fmt(SLOWDOWN, 0) + 'x slower than real. Click an object to brake it.');
        setReadout('Black hole (non-spinning)', rows);
    };
    syncVisuals();
    // Runs every time the scene is drawn, so the view stays right while paused, scrubbing or replaying
    shadow.onBeforeRender = syncVisuals;

    // Trails: the newest point follows the object; once it is swallowed the trail shrinks into where it vanished
    let tick = 0;
    addFrameCallback(() => {
        if (tick++ % 2 !== 0) return;
        const rs = horizon();
        debris.forEach(d => {
            const p = d.body.position;
            if (p.length() >= rs) d.last.set(p.x, p.y, p.z);
            const t = d.trail;
            t.pos.copyWithin(0, 3);
            t.pos.set([d.last.x, d.last.y, d.last.z], (TRAIL - 1) * 3);
            t.geometry.attributes.position.needsUpdate = true;
        });
    });
  `,
  sliders: [
    { label: "Black Hole Mass", targetLabel: "BlackHole", property: "mass", min: 3, max: 25, value: 10, step: 0.5 },
    { label: "Gas Drag", targetLabel: "debris", property: "damping", min: 0, max: 0.2, value: 0, step: 0.005 }
  ]
};
