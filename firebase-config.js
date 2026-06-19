// 예닮교회 — Firebase 공통 초기화 모듈
// index.html, board.html 등 모든 사랑방 페이지가 이 파일을 import 해서 사용한다.
// 설정값이 바뀌면 이 파일 한 곳만 고치면 된다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// 공개 가능한 값 (apiKey는 콘솔 값과 정확히 일치해야 함)
const firebaseConfig = {
  apiKey: "AIzaSyDuw77cPbQWQK0o4J9MG6dqW1f87RQVra0",
  authDomain: "church-manager-5f6a0.firebaseapp.com",
  projectId: "church-manager-5f6a0",
  storageBucket: "church-manager-5f6a0.firebasestorage.app",
  messagingSenderId: "502227266989",
  appId: "1:502227266989:web:b0520770053748f5f54524"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
