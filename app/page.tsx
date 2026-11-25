"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useState, useEffect } from "react";
import {
  giwaSepoliaAutoRouteDeployment,
  buildCreateAmmoraV4Launch,
  getAmmoraV4ConfigAtBlock,
  verifyAmmoraV4CoreAtBlock,
  AmmoraDataApiClient,
  AmmoraV4LaunchCurveClient,
} from "@ammora-protocol/sdk";
import { parseEther, erc20Abi } from "viem";

const dataApi = new AmmoraDataApiClient("https://ammora-giwa-sepolia-data.fly.dev");

export default function Home() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [configId, setConfigId] = useState("10");
  const [name, setName] = useState("Test Token");
  const [symbol, setSymbol] = useState("TEST");
  const [createStatus, setCreateStatus] = useState("");

  const [launches, setLaunches] = useState<any[]>([]);
  const [curve, setCurve] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [quote, setQuote] = useState("");
  const [tradeStatus, setTradeStatus] = useState("");

  useEffect(() => {
    dataApi.getLaunches({ chainId: BigInt(91342), limit: 30 })
      .then(setLaunches)
      .catch(console.error);
  }, []);

  async function handleCreate() {
    if (!publicClient || !walletClient || !address) return;
    setCreateStatus("Готовлю...");

    try {
      const contracts = giwaSepoliaAutoRouteDeployment.contracts.launch;
      const block = await publicClient.getBlockNumber();

      await verifyAmmoraV4CoreAtBlock(publicClient, {
        configRegistry: contracts.configRegistry,
        launchFactory: contracts.factory,
        graduationAdapter: contracts.graduationAdapter,
        feePolicy: contracts.feePolicy,
      }, block);

      const entry = await getAmmoraV4ConfigAtBlock(
        publicClient,
        contracts.configRegistry,
        BigInt(configId),
        block
      );

      if (!entry.enabled) throw new Error("Config выключен");

      const tx = buildCreateAmmoraV4Launch({
        name,
        symbol,
        metadataURI: "https://example.com/meta.json",
        creatorMetadataURI: "https://example.com/meta.json",
        tokenDecimals: entry.config.tokenDecimals,
      }, BigInt(configId), entry.config.poolCreationFee);

      const hash = await walletClient.sendTransaction({
        to: contracts.factory,
        data: tx.data,
        value: tx.value ?? 0n,
      });

      setCreateStatus(`Отправлено: ${hash}`);
    } catch (e: any) {
      setCreateStatus("Ошибка: " + (e.shortMessage || e.message));
    }
  }

  async function handleQuote() {
    if (!publicClient || !curve) return;
    setQuote("Считаю...");

    try {
      const contracts = giwaSepoliaAutoRouteDeployment.contracts.launch;
      const block = await publicClient.getBlockNumber();
      const client = new AmmoraV4LaunchCurveClient(publicClient, curve as `0x${string}`, {
        configRegistry: contracts.configRegistry,
        launchFactory: contracts.factory,
        graduationAdapter: contracts.graduationAdapter,
        feePolicy: contracts.feePolicy,
      });

      const amountIn = direction === "buy" ? parseEther(amount) : BigInt(amount);
      const q = await client.quoteExactInputAtBlock(amountIn, direction === "sell", block);

      setQuote(
        direction === "buy"
          ? `Получишь ≈ ${q.amountOut.toString()} raw tokens`
          : `Получишь ≈ ${(Number(q.amountOut) / 1e18).toFixed(6)} ETH`
      );
    } catch (e: any) {
      setQuote("Ошибка: " + (e.shortMessage || e.message));
    }
  }

  async function handleTrade() {
    if (!publicClient || !walletClient || !address || !curve) return;
    setTradeStatus("Отправка...");

    try {
      const contracts = giwaSepoliaAutoRouteDeployment.contracts.launch;
      const client = new AmmoraV4LaunchCurveClient(publicClient, curve as `0x${string}`, {
        configRegistry: contracts.configRegistry,
        launchFactory: contracts.factory,
        graduationAdapter: contracts.graduationAdapter,
        feePolicy: contracts.feePolicy,
      });

      const amountIn = direction === "buy" ? parseEther(amount) : BigInt(amount);

      if (direction === "sell") {
        const state = await client.getStateAtBlock(await publicClient.getBlockNumber());
        const token = state.baseToken as `0x${string}`;

        const allowance = await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, curve as `0x${string}`],
        });

        if (allowance < amountIn) {
          setTradeStatus("Делаю approve...");
          const approveHash = await walletClient.writeContract({
            address: token,
            abi: erc20Abi,
            functionName: "approve",
            args: [curve as `0x${string}`, amountIn],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      const plan = await client.planSwapExactInput({
        includedAmountIn: amountIn,
        baseForQuote: direction === "sell",
        allowPartialFill: false,
        slippageBps: 100,
        recipient: address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
      });

      const hash = await walletClient.sendTransaction({
        to: plan.transaction.to,
        data: plan.transaction.data,
        value: plan.transaction.value ?? 0n,
      });

      setTradeStatus(`${direction === "buy" ? "Buy" : "Sell"} отправлен: ${hash}`);
    } catch (e: any) {
      setTradeStatus("Ошибка: " + (e.shortMessage || e.message));
    }
  }

  return (
    <main>
      <h1>Ammora Launchpad</h1>
      <ConnectButton />

      <section>
        <h2>Создать токен</h2>
        <input value={configId} onChange={e => setConfigId(e.target.value)} placeholder="Config ID (не 6)" />
        <br /><br />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
        <br /><br />
        <input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="Symbol" />
        <br /><br />
        <button onClick={handleCreate} disabled={!isConnected}>Создать</button>
        <p>{createStatus}</p>
      </section>

      <section>
        <h2>Последние запуски</h2>
        {launches.length === 0 && <p>Загрузка...</p>}
        <ul>
          {launches.map((l: any) => (
            <li key={l.token || l.curve}>
              <strong>{l.name || "Token"}</strong> ({l.symbol || "?"})
              <br />Curve: {l.curve}
              <button onClick={() => setCurve(l.curve)}>Торговать</button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Торговать</h2>
        <input value={curve} onChange={e => setCurve(e.target.value)} placeholder="Curve address" />
        <br /><br />
        <button onClick={() => setDirection("buy")} style={{ background: direction === "buy" ? "#7c3aed" : "#333" }}>Купить</button>
        <button onClick={() => setDirection("sell")} style={{ background: direction === "sell" ? "#7c3aed" : "#333" }}>Продать</button>
        <br /><br />
        <input
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder={direction === "buy" ? "ETH (0.01)" : "Raw amount токенов"}
        />
        <br /><br />
        <button onClick={handleQuote}>Котировка</button>
        <button onClick={handleTrade} disabled={!isConnected}>
          {direction === "buy" ? "Купить" : "Продать"}
        </button>
        <p>{quote}</p>
        <p>{tradeStatus}</p>
      </section>
    </main>
  );
}
