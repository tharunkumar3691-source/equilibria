// Shared stage for the built-in demos: floor (top at y=0), softer fog and a shadow-casting key light.
export const stage = (floorColor: string) => `
    world.allowSleep = true;
    if (scene.fog) { scene.fog.near = 50; scene.fog.far = 170; }

    const floorMat = new CANNON.Material();
    const floorBody = new CANNON.Body({ mass: 0, material: floorMat, shape: new CANNON.Box(new CANNON.Vec3(20, 1, 20)) });
    floorBody.position.set(0, -1, 0);
    world.addBody(floorBody);

    const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(40, 2, 40), new THREE.MeshStandardMaterial({ color: ${floorColor}, roughness: 0.85 }));
    floorMesh.position.set(0, -1, 0);
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const keyLight = new THREE.SpotLight(0xffffff, 1.2, 0, 0.7, 0.6, 0);
    keyLight.position.set(12, 36, 18);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    scene.add(keyLight);
`;
