import { createPlatform } from './app.js';

const DEFAULT_PORT = 7070;

const port = process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT;
const accessToken = process.env.ACCESS_TOKEN;
const seedDir = process.env.SEED_DIR ?? './seed';
const hostname = process.env.HOST ?? '127.0.0.1';
const pgPort = process.env.PG_PORT ? Number(process.env.PG_PORT) : undefined;

const platform = await createPlatform({ accessToken, seedDir });
const server = await platform.listen({ port, hostname });
console.log(`platform-lite listening at ${server.url}`);
if (pgPort !== undefined) {
  const pg = await platform.listenPg({ port: pgPort, hostname });
  console.log(`platform-lite postgres wire listening at ${pg.host}:${pg.port}`);
}
