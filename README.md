# 🏥 رفاد (Refad) — نظام إدارة شركات توزيع الأدوية

نظام ERP متكامل لإدارة شركات توزيع الأدوية، مبني بتقنيات حديثة:

- **Frontend:** HTML + CSS + Vanilla JavaScript
- **Backend:** Supabase (REST API + Storage + Realtime)
- **PWA:** يعمل offline + قابل للتثبيت
- **اللغة:** عربي (RTL) مع دعم إنجليزي

---

## 🚀 البدء السريع

### 1) إنشاء قاعدة البيانات

افتح [Supabase](https://supabase.com) → SQL Editor → الصق محتوى `supabase.sql` كاملاً → Run.

**حساب إدارة الشركات الافتراضي:**
- Username: `superadmin`
- Password: `22446688`

حساب الشركة الافتراضي: `admin` / `22446688`. عند إنشاء قاعدة بيانات موجودة مسبقاً، شغّل `superadmin-setup.sql` من SQL Editor لإضافة حساب إدارة الشركات دون إعادة إنشاء الجداول. بيانات تسجيل الدخول تُقرأ من جدول `users`؛ لتغيير كلمة المرور الافتراضية حدّث حقل `password` للحساب `superadmin` من قاعدة البيانات.

لإتاحة بيع الأصناف للموردين وربط فواتير البيع بحساب المورد، شغّل `sales-supplier-setup.sql` في قواعد البيانات القائمة. قواعد البيانات الجديدة تتضمن التغيير في `supabase.sql`.

### 2) إنشاء Storage Buckets

في Supabase Dashboard → Storage، أنشئ 3 buckets (كلها Public):
