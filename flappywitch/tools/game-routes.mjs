export function gameRoutes(baseUrl) {
  const game = new URL(baseUrl);
  if (!game.pathname.endsWith('/')) throw new Error('BASE_URL must end in /');
  return {
    gamePath: game.pathname,
    gameUrl: new URL('?seed=42&quality=low', game),
    arcadePath: new URL('../index.html', game).pathname,
  };
}
