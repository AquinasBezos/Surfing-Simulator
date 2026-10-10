# Technical Specification & Prompt: WebXR First-Person Realistic Surfing Game

## Objective
Build a web-based, first-person realistic surfing game using **Three.js** and **WebXR**. The game must support dual platforms: **PC Web Browsers** (Keyboard/Mouse) and **Meta Quest (VR/WebXR)**. 

The primary focus of this project is **photorealistic water visualization**, realistic wave mechanics, and intuitive platform-specific controls for both prone (paddling) and standing (surfing) states.

---

## 1. Visuals & Rendering (Photorealistic Water)

The water visual implementation must closely match high-end ocean rendering with custom shaders (GLSL) emphasizing transparency, refraction, sub-surface scattering, and dynamic foam generation.

### Key Visual Requirements:
1. **Water Surface Shader & Color Profile**:
   * **Translucency & Refraction**: Crisp, barrel-transparent turquoise ocean color scheme based on provided reference stills. Use normal map distortion for refractions.
   * **Sub-Surface Scattering (SSS)**: Light passing through the crest of the wave/barrel must glow with vibrant tropical turquoise/emerald tones.
   * **Fresnel Effect**: Smooth transition from clear transparency when looking straight down to metallic/sky reflections at sharp glancing angles.
   * **Caustics & Depth**: Attenuation of light through water depth, revealing subtle seabed textures near shore.

2. **Wave Mesh & Wave Deformation**:
   * Implement procedural wave formulas (e.g., Gerstner Waves combined with a custom curl/pitched wave profile to form playable barrels and breaking lips).
   * Smooth vertex displacement dynamically calculated on the GPU for real-time performance in WebXR (targeting stable 72/90 FPS on Meta Quest).

3. **Whitewater & Foam Simulation**:
   * **Lip Crash & Barrel Foam**: Dynamic foam textures applied where wave slope steepness exceeds threshold limits or near the wave lip break.
   * **Seafoam & Bubbles**: Procedural noise maps blended into the water shader at the crest and trailing edge of broken waves.
   * **Particle Effects**: Optional lightweight GPU particle sprays at the wave crest/lip for extra immersion without heavy performance penalties.

---

## 2. Controls & Dual-Platform Support

The game automatically toggles between **Prone State (Paddling)** and **Standing State (Surfing)** based on user inputs.

| Action | PC Controls | Meta Quest (WebXR) Controls |
| :--- | :--- | :--- |
| **Paddling Forward** | Scroll Wheel (Scroll down/up continuously) | Alternating hand movement gestures using VR Controllers (sweeping motion back-to-front in water) |
| **Paddles Direction Steering** | `A` key (Left) / `D` key (Right) | Differential paddling force (paddling harder/longer on the right turns left, and vice versa) |
| **Pop-Up / Stand Up** | `Spacebar` | Physical action: Standing up vertically relative to initial head height / VR boundary setup |
| **Steering / Weight Shift (Surfing)** | `WASD` keys (Moves surfer center of mass on board to tilt, pitch, and turn) | Physical Head/Body Movement (Leaning head/torso forward, backward, left, or right) |

---

## 3. Physics & Mechanics

1. **Hydrodynamics & Board Behavior**:
   * The wave collision and buoyancy model can use smooth underlying mathematical wave surfaces (ignoring chaotic turbulent whitewater geometry for simple buoyancy calculations).
   * Board buoyancy aligns with the smooth wave surface normal vectors.
   * Velocity increases when carving down the wave face; speed drops when climbing or carving uphill.

2. **State Machine**:
   * **Prone (Paddling)**: Low camera offset, board lies flat, forward speed driven by paddle inputs.
   * **Transition (Pop-up)**: Fast smooth camera shift on PC via `Spacebar`; physical height detect on Quest.
   * **Standing (Surfing)**: Elevated camera, board response turns high-sensitivity based on weight shifting (WASD on PC / HMD head position offset on Quest).

---

## 4. Technical Architecture Guidelines

* **Engine**: Three.js (r150+)
* **XR Framework**: `THREE.VRButton`, WebXR Manager, Controller Event Listeners
* **Shaders**: Custom `RawShaderMaterial` or extended `MeshPhysicalMaterial` using custom GLSL for wave displacement, fresnel reflections, SSS, and procedural foam blending.
* **Performance Targets**:
  * **PC**: 60+ FPS at 1080p/4K.
  * **Meta Quest 2/3/Pro**: Native WebXR render loop locked at 72 FPS or 90 FPS with optimized draw calls and geometry LODs for waves.

---

## Instructions for AI / Developer

1. Scaffold a single modular application with scene setup, lighting (sun directional light + HDRI environment sky), ocean plane mesh, dynamic wave shader, and board mesh.
2. Implement dual input handlers (PC event listeners + WebXR frame updates).
3. Build smooth shader logic matching the reference imagery: vibrant clear barrel water, sun glints on the wave shoulder, and rich crest foam.
4. Integrate the physics loop calculating board slope alignment, gravitational pull down the wave face, and paddle impulse momentum.