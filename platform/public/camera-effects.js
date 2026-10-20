(function initializeQSessionCameraEffects(global) {
  const ASSETS = {
    qfauna: '/camera-effects/q-fauna-jaguar.png',
    halo: '/camera-effects/resonance-halo.png',
    veil: '/camera-effects/quantum-veil.png',
  };

  class CameraEffectEngine {
    constructor(stream, {effect = 'none', intensity = .7, frameRate = 24} = {}) {
      this.stream = stream;
      this.effect = effect;
      this.intensity = intensity;
      this.frameRate = frameRate;
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = stream;
      this.canvas = document.createElement('canvas');
      this.context = this.canvas.getContext('2d', {alpha: false});
      this.images = Object.fromEntries(Object.entries(ASSETS).map(([key, url]) => {
        const image = new Image(); image.src = url; return [key, image];
      }));
      this.particles = Array.from({length: 42}, (_, index) => ({x: Math.random(), y: Math.random(), r: 1 + Math.random() * 4, speed: .00015 + Math.random() * .00055, hue: index * 17}));
      this.frameTimer = null;
      this.stopped = false;
      this.outputStream = null;
      this.customRecipe = {prompt: '', trigger: 'always'};
      this.motionCanvas = document.createElement('canvas');
      this.motionCanvas.width = 24;
      this.motionCanvas.height = 18;
      this.motionContext = this.motionCanvas.getContext('2d', {willReadFrequently: true});
      this.previousMotionFrame = null;
      this.motionAmount = 0;
      this.motionFrame = 0;
      this.reactions = [];
      this.handleReaction = event => {
        const emoji = String(event?.detail?.emoji || '').slice(0, 8);
        if (!emoji) return;
        const startedAt = performance.now();
        for (let index = 0; index < 9; index += 1) {
          this.reactions.push({emoji, startedAt: startedAt + index * 95, x: .1 + Math.random() * .8, drift: -.1 + Math.random() * .2, size: .045 + Math.random() * .035});
        }
      };
      global.addEventListener('qsession-camera-reaction', this.handleReaction);
    }

    async start() {
      this.stopped = false;
      await this.video.play();
      const width = this.video.videoWidth || 1280;
      const height = this.video.videoHeight || 720;
      this.canvas.width = width;
      this.canvas.height = height;
      this.draw(performance.now());
      this.outputStream = this.canvas.captureStream(this.frameRate);
      // A broadcast must produce frames even when its window is covered.
      // requestAnimationFrame stops in background windows; it is suitable
      // for UI animation, not for the clock of the published camera track.
      clearInterval(this.frameTimer);
      this.frameTimer = setInterval(() => this.draw(performance.now()), 1000 / this.frameRate);
      const track = this.outputStream.getVideoTracks()[0];
      track.contentHint = 'motion';
      return track;
    }

    setEffect(effect, intensity = this.intensity) {
      this.effect = effect || 'none';
      this.intensity = Math.max(0, Math.min(1, Number(intensity) || 0));
    }

    setCustomRecipe(recipe = {}) {
      this.customRecipe = {
        prompt: String(recipe.prompt || '').trim().slice(0, 180),
        trigger: ['always', 'movement', 'dance'].includes(recipe.trigger) ? recipe.trigger : 'always',
      };
      this.effect = this.customRecipe.prompt ? 'custom' : 'none';
    }

    customSeed() {
      let hash = 2166136261;
      for (const character of this.customRecipe.prompt) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    measureMotion() {
      if (!this.motionContext || this.video.readyState < 2 || this.motionFrame++ % 3) return this.motionAmount;
      this.motionContext.drawImage(this.video, 0, 0, this.motionCanvas.width, this.motionCanvas.height);
      const current = this.motionContext.getImageData(0, 0, this.motionCanvas.width, this.motionCanvas.height).data;
      if (this.previousMotionFrame) {
        let delta = 0;
        for (let index = 0; index < current.length; index += 16) {
          delta += Math.abs(current[index] - this.previousMotionFrame[index]);
          delta += Math.abs(current[index + 1] - this.previousMotionFrame[index + 1]);
          delta += Math.abs(current[index + 2] - this.previousMotionFrame[index + 2]);
        }
        const samples = current.length / 16 * 3;
        const measured = delta / samples / 255;
        this.motionAmount = this.motionAmount * .72 + measured * .28;
      }
      this.previousMotionFrame = new Uint8ClampedArray(current);
      return this.motionAmount;
    }

    drawCustom(time) {
      if (!this.customRecipe.prompt) return;
      const motion = this.measureMotion();
      const threshold = this.customRecipe.trigger === 'dance' ? .075 : this.customRecipe.trigger === 'movement' ? .025 : 0;
      const activation = threshold ? Math.max(0, Math.min(1, (motion - threshold) * 12)) : 1;
      if (activation <= .015) return;
      const prompt = this.customRecipe.prompt.toLocaleLowerCase();
      const seed = this.customSeed();
      const {width: w, height: h} = this.canvas;
      const hue = seed % 360;
      const secondaryHue = (hue + 75 + (seed % 90)) % 360;
      const pulse = .88 + Math.sin(time / 240) * .07 + motion * .7;
      const alpha = (.2 + this.intensity * .58) * activation;
      const centerX = w / 2;
      const headY = h * .28;
      this.context.save();
      this.context.globalCompositeOperation = 'screen';
      this.context.lineCap = 'round';
      this.context.shadowBlur = Math.max(8, w * .018);
      this.context.shadowColor = `hsla(${hue},95%,68%,${alpha})`;
      const galaxy = /galax|univers|cosm|estrella|space|nebula/.test(prompt);
      const crown = /corona|crown|rey|reina/.test(prompt);
      const mask = /máscara|mascara|mask|antifaz|disfraz/.test(prompt);
      const flowers = /flor|flower|jard[ií]n/.test(prompt);
      if (crown) {
        this.context.strokeStyle = `hsla(${hue},95%,70%,${alpha})`;
        this.context.lineWidth = Math.max(3, w * .006);
        this.context.beginPath();
        this.context.moveTo(w * .37, headY);
        this.context.lineTo(w * .41, h * .13);
        this.context.lineTo(w * .47, h * .23);
        this.context.lineTo(w * .53, h * .1);
        this.context.lineTo(w * .59, h * .23);
        this.context.lineTo(w * .63, h * .13);
        this.context.lineTo(w * .66, headY);
        this.context.stroke();
      } else if (mask) {
        this.context.strokeStyle = `hsla(${hue},95%,72%,${alpha})`;
        this.context.lineWidth = Math.max(5, w * .012);
        this.context.beginPath();
        this.context.ellipse(w * .43, h * .34, w * .08 * pulse, h * .045, -.12, 0, Math.PI * 2);
        this.context.ellipse(w * .57, h * .34, w * .08 * pulse, h * .045, .12, 0, Math.PI * 2);
        this.context.stroke();
      } else {
        this.context.strokeStyle = `hsla(${hue},95%,72%,${alpha})`;
        this.context.lineWidth = Math.max(3, w * .007);
        this.context.beginPath();
        this.context.ellipse(centerX, headY, w * .18 * pulse, h * .07 * pulse, 0, 0, Math.PI * 2);
        this.context.stroke();
      }
      const count = galaxy ? 34 : flowers ? 18 : 22;
      for (let index = 0; index < count; index += 1) {
        const angle = time / (1100 + index * 17) + index * 2.399 + (seed % 29);
        const radius = (w * (.16 + (index % 7) * .035)) * (1 + motion * 2.2);
        const x = centerX + Math.cos(angle) * radius;
        const y = headY + Math.sin(angle * 1.17) * radius * .62 + h * .08;
        const size = Math.max(2, w * (.0028 + (index % 4) * .0016)) * (flowers ? 1.7 : 1);
        this.context.fillStyle = `hsla(${index % 2 ? hue : secondaryHue},95%,${galaxy ? 78 : 66}%,${alpha * (.5 + (index % 4) * .12)})`;
        this.context.beginPath();
        if (flowers) {
          for (let petal = 0; petal < 5; petal += 1) {
            const petalAngle = petal / 5 * Math.PI * 2;
            this.context.moveTo(x, y);
            this.context.arc(x + Math.cos(petalAngle) * size, y + Math.sin(petalAngle) * size, size * .65, 0, Math.PI * 2);
          }
        } else this.context.arc(x, y, size, 0, Math.PI * 2);
        this.context.fill();
      }
      this.context.restore();
    }

    baseFilter() {
      const amount = this.intensity;
      if (this.effect === 'nocturne') return `contrast(${1 + amount * .3}) saturate(${1 + amount * .15}) hue-rotate(${amount * 12}deg) brightness(${1 - amount * .12})`;
      if (this.effect === 'spectral') return `contrast(${1 + amount * .5}) saturate(${1 + amount * 1.35}) hue-rotate(${-amount * 18}deg)`;
      return 'none';
    }

    drawAsset() {
      const image = this.images[this.effect];
      if (!image?.complete || !image.naturalWidth) return;
      const {width: w, height: h} = this.canvas;
      this.context.save();
      this.context.globalAlpha = .45 + this.intensity * .55;
      if (this.effect === 'qfauna') {
        const width = w * (.42 + this.intensity * .18);
        const height = width * image.naturalHeight / image.naturalWidth;
        this.context.drawImage(image, (w - width) / 2, h * .09, width, height);
      } else if (this.effect === 'halo') {
        this.context.globalCompositeOperation = 'screen';
        const width = w * .72;
        const height = width * image.naturalHeight / image.naturalWidth;
        this.context.drawImage(image, (w - width) / 2, -h * .04, width, height);
      } else if (this.effect === 'veil') {
        this.context.globalCompositeOperation = 'screen';
        this.context.drawImage(image, 0, 0, w, h);
      }
      this.context.restore();
    }

    drawReactive(time) {
      const {width: w, height: h} = this.canvas;
      if (this.effect === 'field') {
        this.context.save(); this.context.globalCompositeOperation = 'screen';
        for (let index = 0; index < 6; index += 1) {
          const pulse = (Math.sin(time / 420 + index) + 1) / 2;
          this.context.strokeStyle = `hsla(${165 + index * 34},90%,65%,${.1 + this.intensity * .22})`;
          this.context.lineWidth = 2 + index * 1.5;
          this.context.beginPath();
          this.context.ellipse(w / 2, h * .5, w * (.22 + index * .04 + pulse * .015), h * (.36 + index * .03), 0, 0, Math.PI * 2);
          this.context.stroke();
        }
        this.context.restore();
      } else if (this.effect === 'photons') {
        this.context.save(); this.context.globalCompositeOperation = 'screen';
        this.particles.forEach(particle => {
          particle.y -= particle.speed * (10 + this.intensity * 25);
          if (particle.y < -.03) { particle.y = 1.03; particle.x = Math.random(); }
          this.context.fillStyle = `hsla(${particle.hue + time / 35},90%,70%,${.2 + this.intensity * .6})`;
          this.context.beginPath(); this.context.arc(particle.x * w, particle.y * h, particle.r * (.5 + this.intensity), 0, Math.PI * 2); this.context.fill();
        });
        this.context.restore();
      }
    }

    drawReactions(time) {
      if (!this.reactions.length) return;
      const {width: w, height: h} = this.canvas;
      this.context.save();
      this.context.textAlign = 'center';
      this.context.textBaseline = 'middle';
      this.reactions = this.reactions.filter(reaction => {
        const elapsed = time - reaction.startedAt;
        if (elapsed < 0) return true;
        if (elapsed > 3200) return false;
        const progress = elapsed / 3200;
        const alpha = Math.min(1, elapsed / 240) * Math.min(1, (3200 - elapsed) / 650);
        const x = (reaction.x + reaction.drift * progress + Math.sin(progress * 8) * .018) * w;
        const y = h * (1.04 - progress * 1.02);
        this.context.globalAlpha = alpha;
        this.context.font = `${Math.round(w * reaction.size * (1 + progress * .25))}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
        this.context.shadowColor = 'rgba(3,18,34,.35)';
        this.context.shadowBlur = Math.max(4, w * .006);
        this.context.fillText(reaction.emoji, x, y);
        return true;
      });
      this.context.restore();
    }

    draw(time) {
      if (this.stopped) return;
      if (this.video.readyState >= 2) {
        const {width, height} = this.canvas;
        this.context.filter = this.baseFilter();
        this.context.drawImage(this.video, 0, 0, width, height);
        this.context.filter = 'none';
        this.drawAsset();
        this.drawReactive(time);
        if (this.effect === 'custom') this.drawCustom(time);
        this.drawReactions(time);
        this.outputStream?.getVideoTracks()[0]?.requestFrame?.();
      }
    }

    stop() {
      this.stopped = true;
      clearInterval(this.frameTimer);
      this.frameTimer = null;
      this.outputStream?.getTracks().forEach(track => track.stop());
      this.stream?.getTracks().forEach(track => track.stop());
      this.video.srcObject = null;
      global.removeEventListener('qsession-camera-reaction', this.handleReaction);
    }
  }

  global.QSessionCameraEffects = {CameraEffectEngine};
})(window);
