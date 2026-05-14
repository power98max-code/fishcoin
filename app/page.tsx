"use client";

import { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  where,
  runTransaction,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

const START_COIN = 100000;
const START_PRICE = 10000;
const MARKET_INTERVAL = 5 * 60 * 1000;
const GAME_OPEN_AT = new Date("2026-05-15T11:00:00+09:00").getTime();

const crewMembers = [
  { name: "뿌꾸", image: "/streamers/뿌꾸.png" },
  { name: "라거머핀", image: "/streamers/라거머핀.png" },
  { name: "하나나", image: "/streamers/하나나.png" },
  { name: "설레랑", image: "/streamers/설레랑.png" },
  { name: "차밍챠", image: "/streamers/차밍챠.png" },
  { name: "차쯔키", image: "/streamers/차쯔키.png" },
  { name: "표밤", image: "/streamers/표밤.png" },
  { name: "코이", image: "/streamers/코이.png" },
  { name: "사과몽", image: "/streamers/사과몽.png" },
  { name: "하루비", image: "/streamers/하루비.png" },
  { name: "최은뽀", image: "/streamers/최은뽀.png" },
];

type Stock = {
  name: string;
  image: string;
  price: number;
  suspendedUntil?: number;
  changeRate: number;
  history: {
    time: string;
    price: number;
    changeRate: number;
    timestamp?: number;
    xLabel?: string;
  }[];
};

type ChartRange = "5m" | "1h" | "1d";
type Tab = "market" | "portfolio" | "ranking";
type SortType = "price" | "rise" | "fall" | "name";

type RankingUser = {
  uid: string;
  nickname: string;
  totalAsset: number;
};

const makeEmail = (id: string) => `${id}@fishcoin.local`;

const makeDefaultStocks = (): Stock[] =>
  crewMembers.map((member) => ({
    name: member.name,
    image: member.image,
    price: START_PRICE,
    changeRate: 0,
    history: [
      {
        time: "시작",
        price: START_PRICE,
        changeRate: 0,
        timestamp: Date.now(),
      },
    ],
  }));

const blockedNicknames = [
  "두치와뿌꾸",
  "뿌꾸",
  "라거머핀",
  "하나나",
  "설레랑",
  "차밍챠",
  "차쯔키",
  "표밤",
  "코이",
  "사과몽",
  "하루비",
  "최은뽀",
];

const formatMarketTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("market");
  const [chartRange, setChartRange] = useState<ChartRange>("5m");
  const [nickname, setNickname] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [loginId, setLoginId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupId, setSignupId] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupNickname, setSignupNickname] = useState("");
  const [myCoin, setMyCoin] = useState(START_COIN);
  const [lastBankruptcyAt, setLastBankruptcyAt] = useState<number | null>(null);
  const [holdings, setHoldings] = useState<Record<string, number>>({});
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [rankings, setRankings] = useState<RankingUser[]>([]);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [searchText, setSearchText] = useState("");
  const [sortType, setSortType] = useState<SortType>("price");
  const [countdown, setCountdown] = useState(300);
  const [nextMarketUpdateAt, setNextMarketUpdateAt] = useState(
    Date.now() + MARKET_INTERVAL
  );
  const [tradeAmounts, setTradeAmounts] = useState<Record<string, string>>({});

  const now = Date.now();
  const currentHour = new Date().getHours();
  const isGameOpen = now >= GAME_OPEN_AT;
  const isMarketOpen = currentHour >= 9 && currentHour < 21;

  const totalStockValue = stocks.reduce((sum, stock) => {
    return sum + (holdings[stock.name] || 0) * stock.price;
  }, 0);

  const totalAsset = myCoin + totalStockValue;
  const profitRate = ((totalAsset - START_COIN) / START_COIN) * 100;
  const myRank = user
    ? rankings.findIndex((rankUser) => rankUser.uid === user.uid) + 1
    : 0;

  const canUseBankruptcy =
    !lastBankruptcyAt || Date.now() - lastBankruptcyAt >= 24 * 60 * 60 * 1000;

  const minutes = String(Math.floor(countdown / 60)).padStart(2, "0");
  const seconds = String(countdown % 60).padStart(2, "0");

  const topRise = [...stocks].sort((a, b) => b.changeRate - a.changeRate)[0];
  const topFall = [...stocks].sort((a, b) => a.changeRate - b.changeRate)[0];

  const portfolioStocks = stocks.filter(
    (stock) => (holdings[stock.name] || 0) > 0
  );

  const visibleStocks = [...stocks]
    .filter((stock) => stock.name.includes(searchText.trim()))
    .sort((a, b) => {
      if (sortType === "price") return b.price - a.price;
      if (sortType === "rise") return b.changeRate - a.changeRate;
      if (sortType === "fall") return a.changeRate - b.changeRate;
      if (sortType === "name") return a.name.localeCompare(b.name, "ko");
      return 0;
    });

  const currentSelectedStock = selectedStock
    ? stocks.find((stock) => stock.name === selectedStock.name) || selectedStock
    : null;

  const formatChartLabel = (timestamp: number, range: ChartRange) => {
    const date = new Date(timestamp);

    if (range === "1d") {
      return date.toLocaleDateString("ko-KR", {
        month: "numeric",
        day: "numeric",
      });
    }

    return date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getChartData = (stock: Stock) => {
    const recentHistory = stock.history.slice(-864);
    let filtered = recentHistory;

    if (chartRange === "5m") filtered = recentHistory.slice(-72);
    if (chartRange === "1h") filtered = recentHistory.filter((_, i) => i % 12 === 0);
    if (chartRange === "1d") filtered = recentHistory.filter((_, i) => i % 288 === 0);

    const baseTimestamp = Date.now();

    return filtered.map((item, index) => {
      let interval = 5 * 60 * 1000;
      if (chartRange === "1h") interval = 60 * 60 * 1000;
      if (chartRange === "1d") interval = 24 * 60 * 60 * 1000;

      const adjustedTimestamp =
        baseTimestamp - (filtered.length - index - 1) * interval;

      return {
        ...item,
        xLabel: formatChartLabel(adjustedTimestamp, chartRange),
      };
    });
  };

  const getYAxisTicks = (stock: Stock) => {
    const prices = getChartData(stock).map((item) => item.price);
    if (prices.length === 0) return [];

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const start = Math.floor(min / 5000) * 5000;
    const end = Math.ceil(max / 5000) * 5000;
    const ticks = [];

    for (let price = start; price <= end; price += 5000) {
      ticks.push(price);
    }

    return ticks;
  };

  const getXAxisTicks = (stock: Stock) => {
    const data = getChartData(stock);
    if (chartRange === "1h" || chartRange === "1d") return data.map((i) => i.xLabel);
    if (data.length <= 8) return data.map((i) => i.xLabel);

    const tickCount = 8;
    const step = Math.floor((data.length - 1) / (tickCount - 1));
    const ticks = [];

    for (let i = 0; i < tickCount - 1; i++) {
      ticks.push(data[i * step].xLabel);
    }
    ticks.push(data[data.length - 1].xLabel);
    return ticks;
  };

  const formatHistoryTime = (
    item: Stock["history"][number],
    index: number,
    length: number
  ) => {
    const timestamp = item.timestamp ?? Date.now() - (length - index) * MARKET_INTERVAL;
    const date = new Date(timestamp);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = Math.floor(date.getMinutes() / 5) * 5;
    return `${month}-${day} ${hour}:${String(minute).padStart(2, "0")}`;
  };

  const loadRankings = async () => {
    const q = query(collection(db, "users"), orderBy("totalAsset", "desc"), limit(100));
    const snap = await getDocs(q);

    const rankingData = snap.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        uid: docSnap.id,
        nickname: data.nickname || "익명",
        totalAsset: data.totalAsset || 0,
      };
    });

    setRankings(rankingData);
  };

  const getTradeAmount = (stockName: string) => {
    const amount = Number(tradeAmounts[stockName] || 1);

    if (!Number.isInteger(amount) || amount <= 0) {
      alert("수량은 1개 이상 입력해주세요.");
      return 0;
    }

    return amount;
  };

  const signup = async () => {
    if (!signupId || !signupPassword || !signupNickname) {
      alert("아이디, 비밀번호, 닉네임을 모두 입력해주세요.");
      return;
    }

    if (blockedNicknames.includes(signupNickname.trim())) {
      alert("이 닉네임은 사용할 수 없습니다.");
      return;
    }

    try {
      const nicknameQuery = query(
        collection(db, "users"),
        where("nickname", "==", signupNickname.trim())
      );
      const nicknameSnap = await getDocs(nicknameQuery);

      if (!nicknameSnap.empty) {
        alert("이미 사용 중인 닉네임입니다.");
        return;
      }

      const result = await createUserWithEmailAndPassword(
        auth,
        makeEmail(signupId),
        signupPassword
      );

      await setDoc(doc(db, "users", result.user.uid), {
        id: signupId,
        nickname: signupNickname.trim(),
        myCoin: START_COIN,
        holdings: {},
        totalAsset: START_COIN,
        lastBankruptcyAt: null,
        createdAt: new Date().toISOString(),
      });

      setShowAuth(false);
      alert("회원가입 완료!");
    } catch {
      alert("회원가입 실패! 이미 있는 아이디거나 비밀번호가 너무 짧을 수 있어요.");
    }
  };

  const login = async () => {
    if (!loginId || !loginPassword) {
      alert("아이디와 비밀번호를 입력해주세요.");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, makeEmail(loginId), loginPassword);
      setShowAuth(false);
    } catch {
      alert("로그인 실패! 아이디 또는 비밀번호를 확인해주세요.");
    }
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
    setNickname("");
    setMyCoin(START_COIN);
    setHoldings({});
    setIsLoaded(false);
  };

  const buyStock = (stock: Stock) => {
    if (!isGameOpen) {
      alert("어인섬 Fish Coin 거래소는 5월 15일 오전 11시에 오픈합니다.");
      return;
    }
    if (!isMarketOpen) {
      alert("현재 장 마감 상태입니다.");
      return;
    }
    if (!user) {
      alert("로그인이 필요합니다!");
      setShowAuth(true);
      return;
    }
    if (stock.suspendedUntil) {
      alert("거래정지 종목입니다.");
      return;
    }

    const amount = getTradeAmount(stock.name);
    if (amount <= 0) return;

    const totalPrice = stock.price * amount;
    if (myCoin < totalPrice) {
      alert("FC가 부족합니다!");
      return;
    }

    setMyCoin((prev) => prev - totalPrice);
    setHoldings((prev) => ({
      ...prev,
      [stock.name]: (prev[stock.name] || 0) + amount,
    }));
  };

  const sellStock = (stock: Stock) => {
    if (!isGameOpen) {
      alert("어인섬 Fish Coin 거래소는 5월 15일 오전 11시에 오픈합니다.");
      return;
    }
    if (!isMarketOpen) {
      alert("현재 장 마감 상태입니다.");
      return;
    }
    if (!user) {
      alert("로그인이 필요합니다!");
      setShowAuth(true);
      return;
    }
    if (stock.suspendedUntil) {
      alert("거래정지 종목입니다.");
      return;
    }

    const amount = getTradeAmount(stock.name);
    if (amount <= 0) return;

    const currentAmount = holdings[stock.name] || 0;
    if (currentAmount < amount) {
      alert("보유 수량이 부족합니다!");
      return;
    }

    setMyCoin((prev) => prev + stock.price * amount);
    setHoldings((prev) => ({
      ...prev,
      [stock.name]: currentAmount - amount,
    }));
  };

  const setMaxBuy = (stock: Stock) => {
    if (!user) {
      alert("로그인이 필요합니다!");
      setShowAuth(true);
      return;
    }

    const maxAmount = Math.floor(myCoin / stock.price);
    setTradeAmounts((prev) => ({ ...prev, [stock.name]: String(maxAmount) }));
  };

  const setMaxSell = (stock: Stock) => {
    if (!user) {
      alert("로그인이 필요합니다!");
      setShowAuth(true);
      return;
    }

    const maxAmount = holdings[stock.name] || 0;
    setTradeAmounts((prev) => ({ ...prev, [stock.name]: String(maxAmount) }));
  };

  const recoverFromBankruptcy = () => {
    if (!user) {
      alert("로그인이 필요합니다!");
      setShowAuth(true);
      return;
    }

    if (!canUseBankruptcy) {
      alert("파산 신청은 24시간마다 한 번만 가능합니다.");
      return;
    }

    const ok = confirm(
      "파산 신청을 하겠습니까?\n\n보유 주식은 전부 초기화되고\n100,000 FC로 다시 시작합니다.\n\n다음 신청은 24시간 후 가능합니다."
    );

    if (!ok) return;

    setMyCoin(START_COIN);
    setHoldings({});
    setLastBankruptcyAt(Date.now());
    alert("파산 신청이 완료되었습니다.\n100,000 FC로 다시 시작합니다.");
  };

  useEffect(() => {
    const marketRef = doc(db, "market", "main");

    const unsubscribe = onSnapshot(marketRef, async (snapshot) => {
      if (!snapshot.exists()) {
        const defaultStocks = makeDefaultStocks();
        const nowTime = Date.now();
        await setDoc(marketRef, {
          stocks: defaultStocks,
          lastUpdatedAt: nowTime,
          nextUpdateAt: GAME_OPEN_AT,
        });
        return;
      }

      const data = snapshot.data();
      setStocks(data.stocks ?? []);
      setNextMarketUpdateAt(data.nextUpdateAt ?? Date.now() + MARKET_INTERVAL);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      if (!isGameOpen || !isMarketOpen) return;

      const marketRef = doc(db, "market", "main");

      await runTransaction(db, async (transaction) => {
        const marketSnap = await transaction.get(marketRef);
        if (!marketSnap.exists()) return;

        const data = marketSnap.data();
        const nowTime = Date.now();
        const nextUpdateAt = data.nextUpdateAt ?? GAME_OPEN_AT;

        if (nowTime < nextUpdateAt) return;

        const currentStocks: Stock[] = data.stocks ?? [];

        const nextStocks = currentStocks.map((stock) => {
          if (stock.suspendedUntil && nowTime < stock.suspendedUntil) return stock;

          if (stock.suspendedUntil && nowTime >= stock.suspendedUntil) {
            return {
              ...stock,
              price: START_PRICE,
              changeRate: 0,
              suspendedUntil: undefined,
              history: [
                {
                  time: "재상장",
                  price: START_PRICE,
                  changeRate: 0,
                  timestamp: nowTime,
                },
              ],
            };
          }

          let randomRate = Number((Math.random() * 16 - 8).toFixed(2));
          const eventChance = Math.random();

          if (eventChance < 0.05) randomRate = Number((Math.random() * 30).toFixed(2));
          if (eventChance > 0.95) randomRate = Number((-(Math.random() * 30)).toFixed(2));

          const newPrice = Math.max(
            1,
            Math.floor(stock.price * (1 + randomRate / 100))
          );

          if (newPrice <= 1000) {
            return {
              ...stock,
              price: 1000,
              changeRate: randomRate,
              suspendedUntil: nowTime + 24 * 60 * 60 * 1000,
              history: [
                ...stock.history,
                {
                  time: formatMarketTime(nowTime),
                  price: 1000,
                  changeRate: randomRate,
                  timestamp: nowTime,
                },
              ].slice(-864),
            };
          }

          return {
            ...stock,
            price: newPrice,
            changeRate: randomRate,
            history: [
              ...stock.history,
              {
                time: formatMarketTime(nowTime),
                price: newPrice,
                changeRate: randomRate,
                timestamp: nowTime,
              },
            ].slice(-864),
          };
        });

        transaction.set(
          marketRef,
          {
            stocks: nextStocks,
            lastUpdatedAt: nowTime,
            nextUpdateAt: nowTime + MARKET_INTERVAL,
          },
          { merge: true }
        );
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isGameOpen, isMarketOpen]);

  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((nextMarketUpdateAt - Date.now()) / 1000)
      );
      setCountdown(remaining);
    }, 1000);

    return () => clearInterval(timer);
  }, [nextMarketUpdateAt]);

  useEffect(() => {
    if (selectedStock) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "auto";

    return () => {
      document.body.style.overflow = "auto";
    };
  }, [selectedStock]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (!currentUser) {
        setIsLoaded(false);
        return;
      }

      const userRef = doc(db, "users", currentUser.uid);
      const snap = await getDoc(userRef);

      if (snap.exists()) {
        const data = snap.data();
        setNickname(data.nickname || "익명");
        setMyCoin(data.myCoin ?? START_COIN);
        setHoldings(data.holdings ?? {});
        setLastBankruptcyAt(data.lastBankruptcyAt ?? null);
      }

      setIsLoaded(true);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !isLoaded) return;

    setDoc(
      doc(db, "users", user.uid),
      {
        nickname,
        myCoin,
        holdings,
        totalAsset,
        lastBankruptcyAt,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  }, [user, isLoaded, nickname, myCoin, holdings, totalAsset, lastBankruptcyAt]);

  useEffect(() => {
    loadRankings();
    const timer = setInterval(loadRankings, 10000);
    return () => clearInterval(timer);
  }, [totalAsset]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black text-white p-6">
      {!isGameOpen && (
        <div className="mb-6 bg-red-500/20 border border-red-500 text-red-200 rounded-2xl px-5 py-4 text-center font-bold">
          어인섬 Fish Coin 거래소는
          <br />
          5월 15일 오전 11시에 오픈합니다.
        </div>
      )}

      {showAuth && !user && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 relative">
            <button
              onClick={() => setShowAuth(false)}
              className="absolute top-4 right-5 text-zinc-400 hover:text-white text-2xl"
            >
              ×
            </button>

            <div className="flex items-center gap-3 mb-2">
              <img src="/logo.png" alt="로고" className="w-10 h-10 rounded-full object-cover" />
              <h1 className="text-4xl font-black">어인섬 Fish Coin 거래소</h1>
            </div>

            <p className="text-zinc-400 mb-6">로그인하면 FC와 보유 주식이 저장됩니다.</p>

            {authMode === "login" ? (
              <div className="grid gap-3">
                <input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="아이디" className="bg-black border border-zinc-700 rounded-xl p-3" />
                <input value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="비밀번호" type="password" className="bg-black border border-zinc-700 rounded-xl p-3" />
                <button onClick={login} className="bg-emerald-500 hover:bg-emerald-600 rounded-xl p-3 font-black">로그인</button>
                <button onClick={() => setAuthMode("signup")} className="text-zinc-400 hover:text-white">계정이 없나요? 회원가입</button>
              </div>
            ) : (
              <div className="grid gap-3">
                <input value={signupId} onChange={(e) => setSignupId(e.target.value)} placeholder="아이디" className="bg-black border border-zinc-700 rounded-xl p-3" />
                <input value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} placeholder="비밀번호" type="password" className="bg-black border border-zinc-700 rounded-xl p-3" />
                <input value={signupNickname} onChange={(e) => setSignupNickname(e.target.value)} placeholder="닉네임" className="bg-black border border-zinc-700 rounded-xl p-3" />
                <button onClick={signup} className="bg-emerald-500 hover:bg-emerald-600 rounded-xl p-3 font-black">회원가입</button>
                <button onClick={() => setAuthMode("login")} className="text-zinc-400 hover:text-white">이미 계정이 있나요? 로그인</button>
              </div>
            )}
          </div>
        </div>
      )}

      {currentSelectedStock && (
        <div className="fixed inset-0 bg-black z-40">
          <div className="h-screen overflow-y-auto">
            <div className="max-w-7xl mx-auto p-6">
              <button onClick={() => setSelectedStock(null)} className="mb-4 text-zinc-400 hover:text-white text-2xl">←</button>

              <div className="flex flex-col md:flex-row items-center gap-8 mb-8">
                <img src={currentSelectedStock.image} alt={currentSelectedStock.name} className="w-24 h-24 rounded-full object-cover border-4 border-zinc-700" />

                <div>
                  <h2 className="text-2xl font-black mb-3">{currentSelectedStock.name}</h2>
                  <p className="text-zinc-400 text-lg">어인섬 크루 종목 상세 정보</p>
                  <div className={`mt-3 inline-block px-3 py-1 rounded-xl text-sm font-bold ${isMarketOpen ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
                    {isMarketOpen ? "🟢 장 운영중" : "🔴 장 마감"}
                  </div>

                  <div className="mt-5 grid gap-2">
                    <p className="text-2xl font-black">현재가: {currentSelectedStock.price.toLocaleString()} FC</p>
                    <p className={`text-2xl font-black ${currentSelectedStock.changeRate >= 0 ? "text-red-400" : "text-blue-400"}`}>
                      {currentSelectedStock.changeRate >= 0 ? "▲" : "▼"} {Math.abs(currentSelectedStock.changeRate)}%
                    </p>
                    <p className="text-zinc-400 text-xl">내 보유량: {holdings[currentSelectedStock.name] || 0}주</p>
                    <p className="text-zinc-400 text-xl">보유 FC: {myCoin.toLocaleString()} FC</p>
                  </div>
                </div>

                <div className="w-[380px] shrink-0 ml-auto bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4">
                  <p className="text-lg font-black mb-4">주문하기</p>
                  <div className="mb-3">
                    <p className="text-zinc-400 text-sm mb-2">수량</p>
                    <input value={tradeAmounts[currentSelectedStock.name] || "1"} onChange={(e) => setTradeAmounts((prev) => ({ ...prev, [currentSelectedStock.name]: e.target.value }))} type="number" min="1" className="w-full bg-black border border-zinc-700 rounded-xl px-3 py-3 text-center font-bold" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <button onClick={() => setMaxBuy(currentSelectedStock)} className="bg-zinc-800 hover:bg-zinc-700 px-3 py-2 rounded-xl text-sm font-bold">최대</button>
                    <button onClick={() => setMaxSell(currentSelectedStock)} className="bg-zinc-800 hover:bg-zinc-700 px-3 py-2 rounded-xl text-sm font-bold">전량</button>
                  </div>
                  <div className="grid gap-2 text-sm text-zinc-400 mb-4">
                    <div className="flex justify-between"><span>현재가</span><span className="text-white font-bold">{currentSelectedStock.price.toLocaleString()} FC</span></div>
                    <div className="flex justify-between"><span>보유 FC</span><span className="text-white font-bold">{myCoin.toLocaleString()} FC</span></div>
                    <div className="flex justify-between"><span>보유 수량</span><span className="text-white font-bold">{holdings[currentSelectedStock.name] || 0}주</span></div>
                    <div className="flex justify-between border-t border-zinc-800 pt-3"><span>주문 금액</span><span className="text-white font-bold">{(currentSelectedStock.price * Number(tradeAmounts[currentSelectedStock.name] || 1)).toLocaleString()} FC</span></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => buyStock(currentSelectedStock)} className="bg-red-500 hover:bg-red-600 py-3 rounded-xl font-black">매수</button>
                    <button onClick={() => sellStock(currentSelectedStock)} className="bg-blue-500 hover:bg-blue-600 py-3 rounded-xl font-black">매도</button>
                  </div>
                </div>
              </div>

              <div className="h-64 bg-black/30 rounded-3xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-zinc-400 text-sm">봉 단위</span>
                  {(["5m", "1h", "1d"] as ChartRange[]).map((range) => (
                    <button key={range} onClick={() => setChartRange(range)} className={`px-3 py-1 rounded-lg text-sm font-bold ${chartRange === range ? "bg-white text-black" : "bg-zinc-800 text-zinc-400"}`}>
                      {range === "5m" ? "5분" : range === "1h" ? "1시간" : "1일"}
                    </button>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={getChartData(currentSelectedStock)} margin={{ top: 20, right: 30, bottom: 25, left: 10 }}>
                    <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="xLabel" ticks={getXAxisTicks(currentSelectedStock)} tick={{ fill: "#a1a1aa", fontSize: 12 }} axisLine={false} tickLine={false} interval={0} />
                    <YAxis orientation="right" tickMargin={45} ticks={getYAxisTicks(currentSelectedStock)} domain={[(dataMin: number) => Math.floor(dataMin / 5000) * 5000, (dataMax: number) => Math.ceil(dataMax / 5000) * 5000]} tick={{ fill: "#a1a1aa", fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(value) => Number(value).toLocaleString()} />
                    <Tooltip contentStyle={{ backgroundColor: "#111", border: "1px solid #333", borderRadius: "10px", color: "white", fontSize: "12px", padding: "8px 12px" }} labelFormatter={(label) => `시간: ${label}`} formatter={(value) => [`${Number(value).toLocaleString()} FC`, "가격"]} />
                    <Line type="linear" dataKey="price" stroke={currentSelectedStock.changeRate >= 0 ? "#f87171" : "#60a5fa"} strokeWidth={3} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xl font-black">시세 이력</h3>
                  <p className="text-zinc-500 text-sm">최근 3일</p>
                </div>
                <div className="bg-black/30 border border-zinc-800 rounded-2xl">
                  <div className="grid grid-cols-3 px-4 py-3 text-sm text-zinc-400 border-b border-zinc-800">
                    <p>시간</p><p className="text-right">가격</p><p className="text-right">변동</p>
                  </div>
                  {[...currentSelectedStock.history].slice(-864).reverse().map((item, index, reversedHistory) => {
                    const previousItem = reversedHistory[index + 1];
                    const calculatedChangeRate = previousItem ? ((item.price - previousItem.price) / previousItem.price) * 100 : item.changeRate ?? 0;
                    const isUp = calculatedChangeRate >= 0;
                    return (
                      <div key={index} className="grid grid-cols-3 px-4 py-3 text-sm border-b border-zinc-900 last:border-b-0">
                        <p className="text-zinc-400">{formatHistoryTime(item, currentSelectedStock.history.indexOf(item), currentSelectedStock.history.length)}</p>
                        <p className="text-right font-bold">{item.price.toLocaleString()} FC</p>
                        <p className={`text-right font-bold ${isUp ? "text-red-400" : "text-blue-400"}`}>{isUp ? "↗" : "↘"} {Math.abs(calculatedChangeRate).toFixed(2)}%</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        <header className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <p className="text-emerald-400 font-bold mb-2">FISH COIN EXCHANGE</p>
            <h1 className="text-4xl font-black mb-3">🐟 어인섬 Fish Coin 거래소</h1>
            <div className={`mb-3 inline-block px-3 py-1 rounded-xl text-sm font-bold ${isMarketOpen ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
              {isMarketOpen ? "🟢 장 운영중 09:00~21:00" : "🔴 장 마감 09:00 재개"}
            </div>
            <p className="text-zinc-400 text-lg">
              {user ? `${nickname}님 환영합니다. 데이터는 자동 저장됩니다.` : "로그인하지 않아도 시장은 볼 수 있습니다."}
            </p>
          </div>

          {user ? (
            <div className="flex items-center gap-2">
              <button onClick={recoverFromBankruptcy} disabled={!!user && !canUseBankruptcy} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${!!user && !canUseBankruptcy ? "bg-zinc-700 text-zinc-500 cursor-not-allowed" : "bg-yellow-400 hover:bg-yellow-500 text-black"}`}>
                {!!user && !canUseBankruptcy ? "파산 대기중" : "파산 신청"}
              </button>
              <button onClick={logout} className="bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded-xl text-sm font-bold">로그아웃</button>
            </div>
          ) : (
            <button onClick={() => setShowAuth(true)} className="bg-emerald-500 hover:bg-emerald-600 px-5 py-3 rounded-2xl font-black">로그인 / 회원가입</button>
          )}
        </header>

        {!isMarketOpen && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-2xl p-4 text-center">
            <p className="text-red-300 font-black text-lg">🔴 현재 장 마감 상태입니다.</p>
            <p className="text-zinc-400 text-sm mt-1">오전 09:00에 거래가 재개됩니다.</p>
          </div>
        )}

        <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-3xl p-4"><p className="text-zinc-400 text-sm mb-2">보유 FC</p><p className="text-2xl font-black">{user ? myCoin.toLocaleString() : "-"} FC</p></div>
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-3xl p-4"><p className="text-zinc-400 text-sm mb-2">총 자산</p><p className="text-2xl font-black">{user ? totalAsset.toLocaleString() : "-"} FC</p></div>
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-3xl p-4"><p className="text-zinc-400 text-sm mb-2">수익률</p><p className={`text-2xl font-black ${profitRate >= 0 ? "text-red-400" : "text-blue-400"}`}>{user ? `${profitRate >= 0 ? "+" : ""}${profitRate.toFixed(2)}%` : "-"}</p></div>
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-3xl p-4"><p className="text-zinc-400 text-sm mb-2">내 랭킹</p><p className="text-3xl font-black">{myRank > 0 ? `${myRank}위` : "-"}</p></div>
        </section>

        {topRise && topFall && (
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div className="bg-red-500/10 border border-red-500/30 rounded-3xl p-4"><p className="text-zinc-400 text-sm mb-1">🔥 오늘 급등</p><p className="text-2xl font-black">{topRise.name} <span className="text-red-400">▲ {Math.abs(topRise.changeRate)}%</span></p></div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-3xl p-4"><p className="text-zinc-400 text-sm mb-1">📉 오늘 급락</p><p className="text-2xl font-black">{topFall.name} <span className="text-blue-400">▼ {Math.abs(topFall.changeRate)}%</span></p></div>
          </section>
        )}

        <div className="flex justify-end mb-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-2 text-sm text-zinc-300">
            {!isGameOpen ? "5월 15일 오전 11시 오픈 예정" : isMarketOpen ? (
              <>다음 변동까지 <span className="font-black text-white">{minutes}:{seconds}</span></>
            ) : "현재 장 마감"}
          </div>
        </div>

        <nav className="grid grid-cols-3 gap-3 bg-zinc-900 border border-zinc-800 rounded-3xl p-2 mb-8">
          {[["market", "시장"], ["portfolio", "포트폴리오"], ["ranking", "랭킹"]].map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key as Tab)} className={`rounded-2xl py-3 font-black ${activeTab === key ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}>{label}</button>
          ))}
        </nav>

        {activeTab === "market" && (
          <>
            <div className="flex flex-col md:flex-row gap-3 mb-5">
              <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="검색..." className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 text-white outline-none focus:border-emerald-400" />
              <div className="grid grid-cols-4 gap-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-2">
                {[["price", "가격"], ["rise", "급등"], ["fall", "급락"], ["name", "이름"]].map(([key, label]) => (
                  <button key={key} onClick={() => setSortType(key as SortType)} className={`px-4 py-2 rounded-xl font-black ${sortType === key ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}>{label}</button>
                ))}
              </div>
            </div>

            <section className="grid gap-3">
              {visibleStocks.map((stock) => {
                const amount = holdings[stock.name] || 0;
                const isUp = stock.changeRate >= 0;

                return (
                  <div key={stock.name} onClick={() => setSelectedStock(stock)} className={`rounded-2xl px-4 py-3 transition hover:scale-[1.01] cursor-pointer shadow-xl border ${isUp ? "bg-red-500/5 border-red-500/30" : "bg-blue-500/5 border-blue-500/30"}`}>
                    <div className="flex flex-row items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-[180px]">
                        <img src={stock.image} alt={stock.name} className={`w-10 h-10 rounded-full object-cover border ${isUp ? "border-red-400" : "border-blue-400"}`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-lg font-black">{stock.name}</h2>
                            {stock.price <= 1500 && stock.price > 1000 && <span className="bg-yellow-500/20 text-yellow-300 text-xs font-bold px-2 py-1 rounded-lg border border-yellow-500/30">⚠ 상폐위기</span>}
                            {stock.suspendedUntil && <span className="bg-red-500/20 text-red-300 text-xs font-bold px-2 py-1 rounded-lg border border-red-500/30">⛔ 거래정지</span>}
                          </div>
                          <p className="text-zinc-400 text-sm">보유 수량: {amount}주</p>
                          <p className="text-zinc-500 text-xs">평가액: {(amount * stock.price).toLocaleString()} FC</p>
                        </div>
                      </div>

                      <div className="w-56 h-20 bg-black/30 rounded-xl p-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={stock.history}>
                            <Tooltip contentStyle={{ backgroundColor: "#111", border: "1px solid #333", borderRadius: "10px", color: "white", fontSize: "12px", padding: "6px 10px" }} labelStyle={{ display: "none" }} />
                            <Line type="monotone" dataKey="price" stroke={isUp ? "#f87171" : "#60a5fa"} strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="text-right min-w-[180px]">
                        <p className="text-xl font-black">{stock.price.toLocaleString()} FC</p>
                        <p className={`font-black text-sm ${isUp ? "text-red-400" : "text-blue-400"}`}>{isUp ? "▲" : "▼"} {Math.abs(stock.changeRate)}%</p>

                        <div className="flex items-center gap-2 mt-3 justify-end">
                          <input value={tradeAmounts[stock.name] || "1"} onClick={(e) => e.stopPropagation()} onChange={(e) => setTradeAmounts((prev) => ({ ...prev, [stock.name]: e.target.value }))} type="number" min="1" className="w-16 bg-black border border-zinc-700 rounded-xl px-2 py-2 text-sm text-center" />
                          <button onClick={(e) => { e.stopPropagation(); setMaxBuy(stock); }} className="bg-zinc-700 hover:bg-zinc-600 px-3 py-2 rounded-xl text-xs font-bold">최대</button>
                          <button onClick={(e) => { e.stopPropagation(); buyStock(stock); }} className="bg-red-500 hover:bg-red-600 px-3 py-2 rounded-xl text-sm font-bold">매수</button>
                          <button onClick={(e) => { e.stopPropagation(); setMaxSell(stock); }} className="bg-zinc-700 hover:bg-zinc-600 px-3 py-2 rounded-xl text-xs font-bold">전량</button>
                          <button onClick={(e) => { e.stopPropagation(); sellStock(stock); }} className="bg-blue-500 hover:bg-blue-600 px-3 py-2 rounded-xl text-sm font-bold">매도</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          </>
        )}

        {activeTab === "portfolio" && (
          <section className="grid gap-4">
            {!user ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-10 text-center"><p className="text-2xl font-black mb-2">로그인이 필요합니다</p><p className="text-zinc-400 mb-5">포트폴리오는 로그인 후 확인할 수 있습니다.</p></div>
            ) : portfolioStocks.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-10 text-center"><p className="text-2xl font-black mb-2">보유 종목이 없습니다</p><p className="text-zinc-400">시장 탭에서 원하는 종목을 매수해보세요.</p></div>
            ) : (
              portfolioStocks.map((stock) => (
                <div key={stock.name} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4"><img src={stock.image} alt={stock.name} className="w-16 h-16 rounded-full object-cover" /><div><h2 className="text-2xl font-black">{stock.name}</h2><p className="text-zinc-400">{holdings[stock.name]}주 보유중</p></div></div>
                    <div className="text-right"><p className="text-2xl font-black">{(holdings[stock.name] * stock.price).toLocaleString()} FC</p></div>
                  </div>
                </div>
              ))
            )}
          </section>
        )}

        {activeTab === "ranking" && (
          <section className="bg-zinc-900/80 border border-zinc-800 rounded-3xl p-4">
            <h2 className="text-2xl font-black mb-5">🏆 FC 랭킹 TOP 100</h2>
            {rankings.length === 0 ? (
              <p className="text-zinc-400">아직 랭킹 데이터가 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-zinc-500 border-b border-zinc-800"><th className="py-3 text-left">순위</th><th className="py-3 text-left">닉네임</th><th className="py-3 text-right">총 자산</th></tr></thead>
                  <tbody>
                    {rankings.slice(0, 100).map((rankUser, index) => (
                      <tr key={rankUser.uid} className={`border-b border-zinc-900 ${user && rankUser.uid === user.uid ? "bg-emerald-500/10 text-emerald-300" : "hover:bg-white/5"}`}>
                        <td className="py-3 font-black">#{index + 1}</td>
                        <td className="py-3 font-bold">{rankUser.nickname}{user && rankUser.uid === user.uid && <span className="ml-2 text-xs text-emerald-300">나</span>}</td>
                        <td className="py-3 text-right font-black">{rankUser.totalAsset.toLocaleString()} FC</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
