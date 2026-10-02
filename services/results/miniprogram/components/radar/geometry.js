function point(index, ratio, cx, cy, radius) {
  const angle = -Math.PI / 2 + (index * Math.PI) / 3;
  return [
    cx + Math.cos(angle) * radius * ratio,
    cy + Math.sin(angle) * radius * ratio,
  ];
}
module.exports = { point };
