import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

admin.initializeApp();

const db = admin.firestore();

const START_PRICE = 10000;
const MARKET_INTERVAL = 10 * 60 * 1000;

type Stock = {
  name: string;
  image: string;
  price: number;
  dayOpenPrice?: number;
  changeRate: number;
  suspendedUntil?: number;
  history?: {
    time: string;
    price: number;
    changeRate: number;
    timestamp: number;
  }[];
};

const isMarketOpenKST = () => {
  const now = new Date();

  const hourText = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hour12: false,
  }).format(now);

  const hour = Number(hourText);

  return hour >= 11 && hour < 19;
};

const getKoreanTimeText = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  });
};

export const updateMarketPrices = onSchedule(
  {
    schedule: "*/10 * * * *",
    timeZone: "Asia/Seoul",
  },
  async () => {
    if (!isMarketOpenKST()) return;

    const marketRef = db.collection("market").doc("main");
    const now = Date.now();

    await db.runTransaction(async (transaction) => {
      const marketSnap = await transaction.get(marketRef);

      if (!marketSnap.exists) return;

      const data = marketSnap.data() || {};
      const stocks: Stock[] = data.stocks || [];

      const nextStocks = stocks.map((stock) => {
        if (stock.suspendedUntil && now < stock.suspendedUntil) {
          return stock;
        }

        if (stock.suspendedUntil && now >= stock.suspendedUntil) {
          return {
            ...stock,
            price: START_PRICE,
            changeRate: 0,
            suspendedUntil: undefined,
            history: [
              ...(stock.history || []).slice(-863),
              {
                time: "재상장",
                price: START_PRICE,
                changeRate: 0,
                timestamp: now,
              },
            ],
          };
        }

        const randomRate = Number((Math.random() * 16 - 8).toFixed(2));

        const newPrice = Math.max(
          100,
          Math.round(stock.price * (1 + randomRate / 100))
        );

        if (newPrice <= 1000) {
          return {
            ...stock,
            price: 1000,
            changeRate: randomRate,
            suspendedUntil: now + 24 * 60 * 60 * 1000,
            history: [
              ...(stock.history || []).slice(-863),
              {
                time: getKoreanTimeText(now),
                price: 1000,
                changeRate: randomRate,
                timestamp: now,
              },
            ],
          };
        }

        return {
          ...stock,
          price: newPrice,
          changeRate: randomRate,
          history: [
            ...(stock.history || []).slice(-863),
            {
              time: getKoreanTimeText(now),
              price: newPrice,
              changeRate: randomRate,
              timestamp: now,
            },
          ],
        };
      });

      transaction.set(
        marketRef,
        {
          stocks: nextStocks,
          lastUpdatedAt: now,
          nextUpdateAt: now + MARKET_INTERVAL,
        },
        { merge: true }
      );
    });
  }
);