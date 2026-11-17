import { LegalPage } from "@/components/shared/legal";
export const metadata = { title: "Maxfiylik siyosati" };
export default function Page() {
  return (
    <LegalPage title="Maxfiylik siyosati">
      <h2>Qanday ma’lumotlarni yig‘amiz</h2>
      <p>Telefon raqami va ism; buyurtma manzillari va safar tarixi; haydovchilar uchun — guvohnoma, shaxsni tasdiqlovchi hujjat, avtomobil hujjatlari va ish vaqtidagi GPS joylashuvi.</p>
      <h2>Nima uchun</h2>
      <p>Buyurtmani bajarish, narxni hisoblash, haydovchini topish, xavfsizlik hodisalarini ko‘rib chiqish va moliyaviy hisob-kitob uchun.</p>
      <h2>Kim ko‘radi</h2>
      <p>Yo‘lovchining telefoni faqat faol buyurtma davomida biriktirilgan haydovchiga ko‘rinadi va aksincha. Haydovchi joylashuvi faqat u bajarayotgan buyurtma yo‘lovchisiga ko‘rinadi. Haydovchi hujjatlari faqat vakolatli tekshiruvchilarga ochiladi va har bir ko‘rish qayd etiladi.</p>
      <h2>Saqlash muddati</h2>
      <p>Saqlash muddatlari docs/compliance/privacy-retention-checklist.md da belgilangan va yurist bilan tasdiqlanishi kerak.</p>
      <h2>Huquqlaringiz</h2>
      <p>Ma’lumotlaringizni ko‘rish, tuzatish yoki hisobni o‘chirishni “Yordam” bo‘limi orqali so‘rashingiz mumkin.</p>
    </LegalPage>
  );
}
