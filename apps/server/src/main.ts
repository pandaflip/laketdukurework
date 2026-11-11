import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      console.error('See .env.example for the expected variables.');
      process.exit(1);
    }
    throw error;
  }

  const app = await buildApp(config);

  const shutdown = (): void => {
    void app.close().then(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await app.listen({ host: config.HOST, port: config.PORT });
}

void main();
