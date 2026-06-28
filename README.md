# שרת הפורטל — מדריך הקמה

שרת קטן וחינמי (Vercel) שמפעיל שני דברים באתר החי:
1. **`/api/brain`** — פרוקסי ל-Claude. מחזיק את מפתח ה-API בסוד בצד השרת.
2. **`/api/emails`** — שולף את ההתכתבות מ-Gmail שלך, **מתוחם לכל לקוח בנפרד**.

לקוח רואה אך ורק את ההתכתבות שלו, לפי קוד גישה אישי (token) שאתה נותן לו.

---

## שלב 1 — העלאת הפרויקט ל-Vercel

1. פתח חשבון חינמי ב-https://vercel.com (אפשר עם Google).
2. התקן את הכלי: במחשב, בטרמינל, הרץ `npm i -g vercel`.
3. בתיקיית `server` הזו, הרץ `vercel` ועקוב אחר ההוראות (התחברות + יצירת פרויקט). בסוף תקבל כתובת כמו `https://amirandeden-backend.vercel.app`.
   - (חלופה ללא טרמינל: גרור את תיקיית `server` ל-https://vercel.com/new דרך GitHub.)

> את כל משתני הסביבה (Environment Variables) שלמטה מגדירים בלוח הבקרה של Vercel:
> Project → Settings → Environment Variables. אחרי שמוסיפים — צריך **Redeploy**.

---

## שלב 2 — מפתח Claude (למוח)

1. היכנס ל-https://console.anthropic.com → API Keys → צור מפתח.
2. ב-Vercel הוסף משתנה: `ANTHROPIC_API_KEY` = המפתח.

---

## שלב 3 — הרשאת Gmail (להתכתבויות)

צריך לתת לשרת גישת **קריאה בלבד** לתיבת ה-Gmail שלך. עושים זאת פעם אחת.

### 3א. יצירת OAuth Client ב-Google
1. https://console.cloud.google.com → צור פרויקט (או בחר קיים).
2. APIs & Services → **Enable APIs** → חפש **Gmail API** → Enable.
3. APIs & Services → **OAuth consent screen** → External → מלא שם אפליקציה ואימייל. תחת **Test users** הוסף את `aharonarchitecture@gmail.com`.
4. APIs & Services → **Credentials** → Create Credentials → **OAuth client ID** → סוג **Web application**.
   - תחת **Authorized redirect URIs** הוסף: `https://developers.google.com/oauthplayground`
   - שמור את ה-**Client ID** וה-**Client secret**.

### 3ב. הפקת Refresh Token (בלי לכתוב קוד)
1. פתח https://developers.google.com/oauthplayground
2. בפינה הימנית-עליונה, לחץ על גלגל השיניים ⚙ → סמן **Use your own OAuth credentials** → הדבק את ה-Client ID וה-Client secret.
3. בצד שמאל, בשדה "Input your own scopes" הדבק: `https://www.googleapis.com/auth/gmail.readonly` → לחץ **Authorize APIs** → התחבר עם `aharonarchitecture@gmail.com` ואשר.
4. לחץ **Exchange authorization code for tokens**. העתק את ה-**Refresh token**.

### 3ג. הגדרת המשתנים ב-Vercel
- `GOOGLE_CLIENT_ID` = ה-Client ID
- `GOOGLE_CLIENT_SECRET` = ה-Client secret
- `GOOGLE_REFRESH_TOKEN` = ה-Refresh token

---

## שלב 4 — קודי גישה ללקוחות (תיחום)

כל לקוח מקבל token אישי. מגדירים מפה אחת בשם `CLIENTS`:

```
CLIENTS = {"k_amir_7f3a9b":{"name":"אמיר מרזוק","email":"marzok@technion.ac.il"},"k_eden_2c8d1e":{"name":"עדן טריף","email":"eden.t115@gmail.com"},"k_wael_5b0f4a":{"name":"וואיל טריף","email":"waeltarif@example.com"}}
```

- החלף את ה-tokens במחרוזות אקראיות משלך (כל מחרוזת ארוכה וייחודית; אל תשתמש במשהו שאפשר לנחש).
- עדכן את כתובות המייל לכתובות האמיתיות של כל לקוח.
- הדבק את כל ה-JSON (שורה אחת) כערך של המשתנה `CLIENTS` ב-Vercel.

---

## שלב 5 — חיבור האתר לשרת

בקובץ `marzouk-tarif-residence.html`, בראש הסקריפט, מלא:

```js
const BACKEND_URL = 'https://amirandeden-backend.vercel.app'; // הכתובת שקיבלת מ-Vercel
```

כל לקוח נכנס עם הקישור האישי שלו, שכולל את הקוד:

```
https://amirandeden.com/?k=k_amir_7f3a9b
```

האתר זוכר את הקוד (נשמר בדפדפן), משתמש בו כדי לשלוף את המיילים של אותו לקוח, ולהפעיל את המוח.

---

## בדיקה
- `/api/brain` ו-`/api/emails` ידחו כל בקשה בלי token תקין (401) — זו ההגנה.
- אם משהו לא עובד, ב-Vercel תחת **Logs** רואים את השגיאה המדויקת.

## אבטחה — חשוב
- ה-tokens הם הסוד. אל תשים אותם בקוד האתר הפומבי; שלח לכל לקוח את הקישור האישי שלו בלבד.
- אם token דלף — פשוט החלף אותו ב-`CLIENTS` ועשה Redeploy.
- גישת ה-Gmail היא קריאה בלבד; השרת לעולם לא שולח ולא מוחק מיילים.
