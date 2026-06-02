import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";

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


const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

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
    const delistedStocks: string[] = [];

    await db.runTransaction(async (transaction) => {
      const marketSnap = await transaction.get(marketRef);

      if (!marketSnap.exists) return;

      const data = marketSnap.data() || {};
      const stocks: Stock[] = data.stocks || [];
const cleanedStocks = stocks.map((stock) => ({
  ...stock,
  history: (stock.history || [])
    .filter((item) => now - item.timestamp < THREE_DAYS)
    .slice(-500),
}));

      const nextStocks = cleanedStocks.map((stock) => {
        if (stock.suspendedUntil && now < stock.suspendedUntil) {
          return stock;
        }

    if (stock.suspendedUntil && now >= stock.suspendedUntil) {
return {
  name: stock.name,
  image: stock.image,
  price: START_PRICE,
  dayOpenPrice: START_PRICE,
  changeRate: 0,
  history: [
  ...(stock.history || [])
    .filter((item) => now - item.timestamp < THREE_DAYS)
    .slice(-499),
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

  delistedStocks.push(stock.name);

  return {
    ...stock,
            price: 1000,
            changeRate: randomRate,
            suspendedUntil: now + 24 * 60 * 60 * 1000,
           history: [
  ...(stock.history || [])
    .filter((item) => now - item.timestamp < THREE_DAYS)
    .slice(-499),
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
  ...(stock.history || [])
    .filter((item) => now - item.timestamp < THREE_DAYS)
    .slice(-499),
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

if (delistedStocks.length > 0) {

  const usersSnap = await db.collection("users").get();

  let batch = db.batch();
  let operationCount = 0;

  for (const userDoc of usersSnap.docs) {

    const holdings = userDoc.data().holdings || {};

    let changed = false;

    for (const stockName of delistedStocks) {

      if (holdings[stockName] !== undefined) {
        delete holdings[stockName];
        changed = true;
      }
    }

    if (changed) {

      batch.update(userDoc.ref, {
        holdings,
      });

      operationCount++;

      if (operationCount >= 450) {
        await batch.commit();
        batch = db.batch();
        operationCount = 0;
      }
    }
  }

  if (operationCount > 0) {
    await batch.commit();
  }
}

}
);
export const giveCompensationNow = onRequest(async (req, res) => {
  const usersSnap = await db.collection("users").get();

  let batch = db.batch();
  let count = 0;
  let updatedCount = 0;

  for (const userDoc of usersSnap.docs) {
    const currentCoin = Number(userDoc.data().myCoin || 0);

    batch.update(userDoc.ref, {
      myCoin: currentCoin + 500000,
    });

    count++;
    updatedCount++;

    if (count >= 450) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  res.send(`500,000 FC 지급 완료: ${updatedCount}명`);
});