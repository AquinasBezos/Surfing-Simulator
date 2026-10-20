// Turntable view of your surfer for the menus, so you can see your skin, hair and board
// colours before you paddle out. Its own small renderer, only running while it's on screen.
import * as THREE from 'three';
import { SurferCharacter, loadSurferModel } from './character.js';
import { createBoard } from './board.js';

export class CharacterPreview {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'look-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.renderer = null;
    this.running = false;
    this.look = null;
    this.boardType = 'shortboard';
    this.board = null;
    this.boardKey = '';
    this.character = null;
    this.angle = 0.7;
    this.last = 0;
  }

  // put the canvas in this screen's preview slot
  attach(slot) {
    if (slot && this.canvas.parentNode !== slot) slot.appendChild(this.canvas);
  }

  set(look, boardType) {
    this.look = look;
    this.boardType = boardType;
    if (this.character) this.character.setLook(look);
    this.syncBoard();
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (!this.renderer) this.init();
    this.last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      this.frame(Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
  }

  init() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.scene.add(new THREE.HemisphereLight(0xcfe6f5, 0x2c4a52, 1.6));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x9fd8f2, 1.2);
    rim.position.set(-3, 2, -3);
    this.scene.add(rim);
    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);
    this.syncBoard();
    loadSurferModel().then((gltf) => {
      this.character = new SurferCharacter(gltf);
      if (this.look) this.character.setLook(this.look);
      this.character.weights = [0, 1, 0, 0, 0]; // already standing
      this.turntable.add(this.character.root);
    });
  }

  syncBoard() {
    if (!this.turntable || !this.look) return;
    const key = `${this.boardType}${this.look.board}`;
    if (key === this.boardKey) return;
    this.boardKey = key;
    if (this.board) {
      this.turntable.remove(this.board);
      this.board.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.map) o.material.map.dispose();
      });
    }
    this.board = createBoard(this.boardType, this.look.board);
    this.turntable.add(this.board);
  }

  frame(dt) {
    const c = this.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * this.renderer.getPixelRatio()) || c.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    const long = this.boardType === 'longboard';
    const d = long ? 6.4 : 5.0;
    this.camera.position.set(0, 1.5, d);
    this.camera.lookAt(0, 0.72, 0);
    this.angle += dt * 0.5;
    this.turntable.rotation.y = this.angle;
    if (this.character) this.character.update(dt, { pose: 'stand', crouch: 0.1 });
    this.renderer.render(this.scene, this.camera);
  }
}
