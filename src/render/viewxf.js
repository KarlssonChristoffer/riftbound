// VIEWXF: world <-> camera-frame conversions (one copy). The game's ground axes are the arena's (x east, y south); the
// camera turned by `yaw` sees them in its VIEW FRAME (x = screen right, y = toward the camera), where the arena's
// projection applies as it is (main.js: the player runs in the view frame).
export const toView = (X, Z, a) => [X * Math.cos(a) - Z * Math.sin(a), X * Math.sin(a) + Z * Math.cos(a)];
export const toWorld = (vx, vy, a) => [vx * Math.cos(a) + vy * Math.sin(a), -vx * Math.sin(a) + vy * Math.cos(a)];
