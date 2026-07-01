import { firestoreApp } from "../../../../config/app.firebase";
import { admin } from "../../../../config/firebase.admin";
import { LOYALTY_PARTNER_COLLECTIONS } from "../../constants/loyalty.constants";
import { PartnerAuditEntry } from "../partner.types";

export class PartnerAuditService {
  private collection = firestoreApp.collection(LOYALTY_PARTNER_COLLECTIONS.AUDIT);

  async log(entry: Omit<PartnerAuditEntry, "createdAt">): Promise<void> {
    await this.collection.add({
      ...entry,
      createdAt: admin.firestore.Timestamp.now(),
    });
  }
}

export const partnerAuditService = new PartnerAuditService();
export default partnerAuditService;
