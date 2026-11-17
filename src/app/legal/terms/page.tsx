import { LegalPage } from "@/components/shared/legal";
export const metadata = { title: "Foydalanish shartlari" };
export default function Page() {
  return (
    <LegalPage title="Foydalanish shartlari">
      <h2>Xizmat</h2>
      <p>NEXT TAXI yo‘lovchilarni mustaqil, tekshiruvdan o‘tgan haydovchilar bilan bog‘laydigan platforma. Pilot hudud: G‘uzor shahri.</p>
      <h2>Narx va to‘lov</h2>
      <p>Narx buyurtma berishdan oldin ko‘rsatiladi va safar davomida o‘zgarmaydi. Hozircha to‘lov faqat naqd pulda, haydovchiga to‘lanadi.</p>
      <h2>Bekor qilish</h2>
      <p>Yo‘lovchi safar boshlangunga qadar buyurtmani bekor qilishi mumkin. Haydovchi yetib kelib, 3 daqiqa kutgandan keyin yo‘lovchi chiqmasa, buyurtmani bekor qilishi mumkin.</p>
      <h2>Xavfsizlik</h2>
      <p>Favqulodda vaziyatda 112 ga qo‘ng‘iroq qiling. Ilovadagi SOS tugmasi operatorga xabar beradi, lekin favqulodda xizmat o‘rnini bosmaydi.</p>
    </LegalPage>
  );
}
