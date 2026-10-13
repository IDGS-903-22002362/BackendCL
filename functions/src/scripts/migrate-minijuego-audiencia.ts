import minijuegoService from "../services/minijuego.service";

async function main(): Promise<void> {
  const result = await minijuegoService.migrateCorreosToUids();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(
    "migrate_minijuego_audiencia_failed",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});