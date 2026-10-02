const geometry = require('./geometry');
Component({
  properties: {
    dimensions: {
      type: Array,
      value: [],
      observer() {
        if (this.ready) this.draw();
      },
    },
    compact: { type: Boolean, value: false },
  },
  lifetimes: {
    ready() {
      this.ready = true;
      this.draw();
    },
    detached() {
      this.ready = false;
    },
  },
  pageLifetimes: {
    resize() {
      this.draw();
    },
  },
  methods: {
    draw() {
      if (!this.ready || this.data.dimensions.length !== 6) return;
      this.createSelectorQuery()
        .select('#radar')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!this.ready || !res[0] || !res[0].node) return;
          const node = res[0].node,
            width = res[0].width,
            height = res[0].height;
          const info = wx.getWindowInfo
            ? wx.getWindowInfo()
            : wx.getSystemInfoSync();
          const dpr = info.pixelRatio || 1;
          node.width = width * dpr;
          node.height = height * dpr;
          const ctx = node.getContext('2d');
          ctx.scale(dpr, dpr);
          const cx = width / 2,
            cy = height / 2,
            radius = Math.min(width, height) * 0.29;
          const path = (ratios) => {
            ctx.beginPath();
            ratios.forEach((r, i) => {
              const p = geometry.point(i, r, cx, cy, radius);
              if (i === 0) ctx.moveTo(p[0], p[1]);
              else ctx.lineTo(p[0], p[1]);
            });
            ctx.closePath();
          };
          ctx.clearRect(0, 0, width, height);
          ctx.lineWidth = 1;
          [1, 0.8, 0.6, 0.4, 0.2].forEach((r, i) => {
            path([r, r, r, r, r, r]);
            ctx.fillStyle = i % 2 ? '#eeeeee' : '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#cccccc';
            ctx.stroke();
          });
          this.data.dimensions.forEach((d, i) => {
            const p = geometry.point(i, 1, cx, cy, radius);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(p[0], p[1]);
            ctx.strokeStyle = '#cccccc';
            ctx.stroke();
          });
          path(
            this.data.dimensions.map((d) =>
              Math.max(0, Math.min(1, d.percent / 100)),
            ),
          );
          ctx.strokeStyle = '#d83232';
          ctx.lineWidth = 2;
          ctx.stroke();
          this.data.dimensions.forEach((d, i) => {
            const p = geometry.point(i, d.percent / 100, cx, cy, radius);
            ctx.beginPath();
            ctx.arc(p[0], p[1], 3, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#d83232';
            ctx.stroke();
            const label = geometry.point(i, 1.4, cx, cy, radius);
            ctx.fillStyle = '#999999';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const name = d.name || '';
            const lines =
              name.length > 4
                ? [
                    name.slice(0, 4),
                    name.length > 8 ? name.slice(4, 7) + '…' : name.slice(4),
                  ]
                : [name.slice(0, 2), name.slice(2)];
            lines
              .filter(Boolean)
              .forEach((line, j) =>
                ctx.fillText(line, label[0], label[1] - 13 + j * 13),
              );
            ctx.fillText(d.coefficient, label[0], label[1] + 16);
          });
        });
    },
  },
});
