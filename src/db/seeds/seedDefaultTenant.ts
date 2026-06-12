import { closeDb } from "../client.js";
import { env } from "../../config/env.js";
import { WhatsAppTenantRepository } from "../../tenant/whatsapp-tenants/index.js";

async function seedDefaultTenant(): Promise<void> {
  const repository = new WhatsAppTenantRepository();
  const tenant = await repository.upsertByPhoneNumberId({
    name: "NeoFibra",
    phoneNumberId: env.META_PHONE_NUMBER_ID,
    wabaId: "WABA_TESTE_0001",
  });

  console.log(
    `[seed] tenant NeoFibra pronto: ${tenant?.id} (${tenant?.phoneNumberId})`
  );
}

try {
  await seedDefaultTenant();
} finally {
  await closeDb();
}
