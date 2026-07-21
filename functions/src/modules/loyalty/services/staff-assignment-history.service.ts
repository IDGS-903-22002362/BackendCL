import { firestoreApp } from "../../../config/app.firebase";
import { LoyaltyChannel } from "../models/loyalty.enums";
import { LoyaltyTransaction } from "../models/loyalty.types";
import ledgerRepository, {
  LedgerRepository,
} from "../repositories/ledger.repository";

const SEARCH_SCAN_LIMIT = 500;
const SEARCH_BATCH_SIZE = 100;

export interface StaffAssignmentHistoryRow {
  transactionId: string;
  memberId: string;
  customerFullName: string | null;
  customerExists: boolean;
  saleId: string | null;
  amountMxn: number | null;
  points: number;
  createdAt: string;
}

interface HistoryOptions {
  actorId: string;
  limit: number;
  cursor?: string;
  search?: string;
}

function normalizedText(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

function searchableText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX");
}

function metadataString(
  transaction: LoyaltyTransaction,
  key: string,
): string | null {
  const value = transaction.metadata?.[key];
  const normalized = normalizedText(value);
  return normalized || null;
}

export class StaffAssignmentHistoryService {
  constructor(
    private readonly ledger: LedgerRepository = ledgerRepository,
    private readonly firestore: FirebaseFirestore.Firestore = firestoreApp,
  ) {}

  private async enrich(
    transactions: LoyaltyTransaction[],
  ): Promise<StaffAssignmentHistoryRow[]> {
    const unresolvedMemberIds = Array.from(
      new Set(
        transactions
          .filter((item) => !metadataString(item, "customerNameSnapshot"))
          .map((item) => item.memberId),
      ),
    );
    const profileNames = new Map<
      string,
      { name: string | null; exists: boolean }
    >();

    if (unresolvedMemberIds.length > 0) {
      const refs = unresolvedMemberIds.map((memberId) =>
        this.firestore.collection("usuariosApp").doc(memberId),
      );
      const snapshots = await this.firestore.getAll(...refs);
      snapshots.forEach((snapshot, index) => {
        const memberId = unresolvedMemberIds[index];
        if (!memberId) return;
        profileNames.set(memberId, {
          exists: snapshot.exists,
          name: snapshot.exists
            ? normalizedText(snapshot.data()?.nombre).slice(0, 120) || null
            : null,
        });
      });
    }

    return transactions.map((transaction) => {
      const snapshotName = metadataString(
        transaction,
        "customerNameSnapshot",
      );
      const profile = profileNames.get(transaction.memberId);
      return {
        transactionId: transaction.transactionId,
        memberId: transaction.memberId,
        customerFullName: snapshotName ?? profile?.name ?? null,
        customerExists: snapshotName ? true : (profile?.exists ?? false),
        saleId: metadataString(transaction, "saleId"),
        amountMxn:
          typeof transaction.amountCents === "number" &&
          Number.isFinite(transaction.amountCents)
            ? transaction.amountCents / 100
            : null,
        points: transaction.points,
        createdAt: transaction.createdAt.toDate().toISOString(),
      };
    });
  }

  private matchesSearch(row: StaffAssignmentHistoryRow, search: string): boolean {
    const needle = searchableText(search);
    return [row.customerFullName, row.saleId, row.memberId].some(
      (value) => value && searchableText(value).includes(needle),
    );
  }

  async list(options: HistoryOptions): Promise<{
    items: StaffAssignmentHistoryRow[];
    nextCursor?: string;
    searchWindowLimited: boolean;
    scannedCount: number;
  }> {
    const search = normalizedText(options.search);
    if (!search) {
      const result = await this.ledger.listAdmin({
        actorId: options.actorId,
        channel: LoyaltyChannel.STORE,
        limit: options.limit,
        cursor: options.cursor,
      });
      return {
        items: await this.enrich(result.items),
        nextCursor: result.nextCursor,
        searchWindowLimited: false,
        scannedCount: result.items.length,
      };
    }

    const matches: StaffAssignmentHistoryRow[] = [];
    let cursor = options.cursor;
    let scannedCount = 0;
    let reachedEnd = false;
    let lastScannedId: string | undefined;

    while (scannedCount < SEARCH_SCAN_LIMIT && matches.length <= options.limit) {
      const batchLimit = Math.min(
        SEARCH_BATCH_SIZE,
        SEARCH_SCAN_LIMIT - scannedCount,
      );
      const batch = await this.ledger.listAdmin({
        actorId: options.actorId,
        channel: LoyaltyChannel.STORE,
        limit: batchLimit,
        cursor,
      });
      if (batch.items.length === 0) {
        reachedEnd = true;
        break;
      }

      const enriched = await this.enrich(batch.items);
      scannedCount += batch.items.length;
      lastScannedId = batch.items[batch.items.length - 1]?.transactionId;
      matches.push(...enriched.filter((row) => this.matchesSearch(row, search)));

      if (matches.length > options.limit) break;
      if (!batch.nextCursor) {
        reachedEnd = true;
        break;
      }
      cursor = batch.nextCursor;
    }

    const page = matches.slice(0, options.limit);
    const hasKnownMoreMatches = matches.length > options.limit;
    const searchWindowLimited =
      !reachedEnd && scannedCount >= SEARCH_SCAN_LIMIT;
    const nextCursor = hasKnownMoreMatches
      ? page[page.length - 1]?.transactionId
      : searchWindowLimited
        ? lastScannedId
        : undefined;

    return {
      items: page,
      nextCursor,
      searchWindowLimited,
      scannedCount,
    };
  }
}

export const staffAssignmentHistoryService =
  new StaffAssignmentHistoryService();

export default staffAssignmentHistoryService;
