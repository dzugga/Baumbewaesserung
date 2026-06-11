// Zentrale Firebase-Projektkonfiguration für ALLE Apps (Desktop + Fahrer/Navi/Erfassung/Einsatzleiter).
// Diese Werte sind öffentlich (stehen ohnehin im ausgelieferten Browser-Code) — der Schutz liegt in
// den Firestore-/Storage-Regeln, App Check und der API-Schlüssel-Beschränkung, nicht in der Geheimhaltung.
// Vorher war dieser Block in jeder App wortgleich dupliziert — bei Änderungen (Domain/Bucket/Projekt)
// nur noch HIER anpassen.
export const firebaseConfig = {
  apiKey: "AIzaSyBShCcASfAG26EDyax6er6SIiqeSBrFWek",
  authDomain: "baumbewaesserung.firebaseapp.com",
  projectId: "baumbewaesserung",
  storageBucket: "baumbewaesserung.firebasestorage.app",
  messagingSenderId: "1001991004222",
  appId: "1:1001991004222:web:1405d80d0788bd6548f16f"
};
