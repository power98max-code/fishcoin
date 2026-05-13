import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDzKXohNU-6QRwyINQwRrx8s4KRpZherK0",
  authDomain: "fish-coin-exchange.firebaseapp.com",
  projectId: "fish-coin-exchange",
  storageBucket: "fish-coin-exchange.firebasestorage.app",
  messagingSenderId: "77655795119",
  appId: "1:77655795119:web:21cbcdea63a2466fce3b5a",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);