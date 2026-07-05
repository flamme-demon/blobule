// Rendu canvas : grille, nourriture, virus, cellules, pseudos.
(function (global) {
  const C = global.CFG;

  function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    const camera = { x: C.WORLD / 2, y: C.WORLD / 2, zoom: 1 };

    function resize() {
      canvas.width = window.innerWidth * devicePixelRatio;
      canvas.height = window.innerHeight * devicePixelRatio;
    }
    window.addEventListener('resize', resize);
    resize();

    function updateCamera(myCells, dt) {
      if (myCells.length > 0) {
        let sx = 0, sy = 0, sm = 0, sr = 0;
        for (const c of myCells) {
          sx += c.x * c.m; sy += c.y * c.m; sm += c.m;
          sr += C.radius(c.m);
        }
        const tx = sx / sm, ty = sy / sm;
        // dézoome quand on grossit ou qu'on est éclaté
        const targetZoom = Math.max(0.35, Math.min(1.4, 42 / (sr + 10) + 0.45));
        const k = Math.min(1, dt * 4);
        camera.x += (tx - camera.x) * k;
        camera.y += (ty - camera.y) * k;
        camera.zoom += (targetZoom - camera.zoom) * k;
      }
      return camera;
    }

    function worldFromScreen(sx, sy) {
      const scale = camera.zoom * devicePixelRatio;
      return {
        x: camera.x + (sx * devicePixelRatio - canvas.width / 2) / scale,
        y: camera.y + (sy * devicePixelRatio - canvas.height / 2) / scale,
      };
    }

    function draw(view, myId) {
      const w = canvas.width, h = canvas.height;
      const scale = camera.zoom * devicePixelRatio;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#111318';
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(scale, 0, 0, scale, w / 2 - camera.x * scale, h / 2 - camera.y * scale);

      // limites visibles du monde
      const viewW = w / scale, viewH = h / scale;
      const x0 = Math.max(0, camera.x - viewW / 2), x1 = Math.min(C.WORLD, camera.x + viewW / 2);
      const y0 = Math.max(0, camera.y - viewH / 2), y1 = Math.min(C.WORLD, camera.y + viewH / 2);

      // grille
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1 / scale;
      const step = 80;
      ctx.beginPath();
      for (let gx = Math.floor(x0 / step) * step; gx <= x1; gx += step) {
        ctx.moveTo(gx, y0); ctx.lineTo(gx, y1);
      }
      for (let gy = Math.floor(y0 / step) * step; gy <= y1; gy += step) {
        ctx.moveTo(x0, gy); ctx.lineTo(x1, gy);
      }
      ctx.stroke();

      // bord du monde
      ctx.strokeStyle = 'rgba(255,80,80,0.5)';
      ctx.lineWidth = 6;
      ctx.strokeRect(0, 0, C.WORLD, C.WORLD);

      const visible = (x, y, r) => x + r > x0 && x - r < x1 && y + r > y0 && y - r < y1;

      // nourriture
      for (const pel of view.pellets) {
        if (!visible(pel.x, pel.y, 6)) continue;
        ctx.fillStyle = pel.c;
        ctx.beginPath();
        ctx.arc(pel.x, pel.y, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      // masse éjectée
      for (const e of view.ejected) {
        if (!visible(e.x, e.y, 10)) continue;
        ctx.fillStyle = e.c;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 10, 0, Math.PI * 2);
        ctx.fill();
      }

      // cellules, des plus petites aux plus grosses (les grosses par-dessus)
      const cells = [];
      for (const p of view.players) {
        for (const c of p.cells) cells.push({ p, c });
      }
      cells.sort((a, b) => a.c.m - b.c.m);
      for (const { p, c } of cells) {
        const r = C.radius(c.m);
        if (!visible(c.x, c.y, r)) continue;
        ctx.fillStyle = p.color;
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = Math.max(2, r * 0.06);
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (r > 18) {
          const fs = Math.max(11, r * 0.35);
          ctx.font = '700 ' + fs + 'px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.lineWidth = fs / 8;
          ctx.strokeText(p.name, c.x, c.y);
          ctx.fillText(p.name, c.x, c.y);
          if (p.id === myId) {
            ctx.font = '600 ' + fs * 0.6 + 'px system-ui, sans-serif';
            ctx.strokeText(String(Math.floor(c.m)), c.x, c.y + fs * 0.85);
            ctx.fillText(String(Math.floor(c.m)), c.x, c.y + fs * 0.85);
          }
        }
      }

      // virus (par-dessus les petites cellules, sous les très grosses : simplifié au-dessus)
      for (const v of view.viruses) {
        const r = C.radius(v.m || C.VIRUS_MASS);
        if (!visible(v.x, v.y, r)) continue;
        ctx.fillStyle = '#33d17a';
        ctx.strokeStyle = '#1d8a4e';
        ctx.lineWidth = 4;
        ctx.beginPath();
        const spikes = 18;
        for (let i = 0; i <= spikes * 2; i++) {
          const a = (i / (spikes * 2)) * Math.PI * 2;
          const rr = i % 2 === 0 ? r : r * 0.86;
          const px = v.x + Math.cos(a) * rr, py = v.y + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    return { camera, updateCamera, worldFromScreen, draw };
  }

  global.Render = { createRenderer };
})(window);
