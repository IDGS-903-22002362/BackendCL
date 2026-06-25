import productService from "../services/product.service";

const DRY_RUN = process.argv.includes("--dry-run");
const INCLUDE_INACTIVE = process.argv.includes("--include-inactive");

async function backfillProductSearchText(): Promise<void> {
  console.log(
    `\nBackfill searchText (${DRY_RUN ? "DRY-RUN" : "EJECUCION"})`,
  );

  const result = await productService.backfillProductSearchText({
    dryRun: DRY_RUN,
    onlyActive: !INCLUDE_INACTIVE,
  });

  console.log("Backfill completado");
  console.log(`   Procesados: ${result.processed}`);
  console.log(`   Actualizados: ${result.updated}`);
  console.log(`   Sin cambios: ${result.skipped}`);
}

backfillProductSearchText().catch((error) => {
  console.error("Error en backfill searchText:", error);
  process.exitCode = 1;
});
