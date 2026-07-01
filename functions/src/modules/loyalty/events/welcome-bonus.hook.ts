import loyaltyEngineService from "../services/loyalty-engine.service";

export async function applyWelcomeBonusForMember(memberId: string): Promise<void> {
  await loyaltyEngineService.applyWelcomeBonus(memberId);
}

export default applyWelcomeBonusForMember;
