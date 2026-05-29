import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import { API_URL, PUBLIX_URL, publixDetailUrl } from "./lib/config";
import { PUBLIX_INJECT } from "./lib/publixInject";

type ListItem = { Id: string; PurchaseDate: string; TotalPrice: number; IsOnlineOrder: boolean };

const GREEN = "#0fa968";
const GREEN_DEEP = "#0a7d4d";
const INK = "#211f1a";
const MUTED = "#918b7e";
const CREAM = "#f3ecdf";

export default function App() {
  const [screen, setScreen] = useState<"home" | "connect">("home");
  const [list, setList] = useState<ListItem[]>([]);
  const [status, setStatus] = useState("Log in to Publix above — your purchases will appear.");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const webRef = useRef<WebView>(null);
  const detailWaiter = useRef<(() => void) | null>(null);
  // Live refs so async orchestration sees current values, not stale closures.
  const listRef = useRef<ListItem[]>([]);
  const detailsRef = useRef<unknown[]>([]);
  const storeRef = useRef("");

  const onMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    let msg: { type?: string; body?: unknown };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === "publix-list") {
      const items = ((msg.body as { PurchasesList?: ListItem[] })?.PurchasesList ?? []) as ListItem[];
      listRef.current = items;
      setList(items);
      const online = items.filter((i) => i.IsOnlineOrder).length;
      setStatus(`Found ${items.length} receipts (${online} online, ${items.length - online} in-store).`);
    } else if (msg.type === "publix-detail") {
      detailsRef.current = [...detailsRef.current, msg.body];
      detailWaiter.current?.();
      detailWaiter.current = null;
    } else if (msg.type === "store") {
      storeRef.current = String(msg.body ?? "");
    }
  }, []);

  // Walk each in-store receipt's detail page (the injector captures its items),
  // then POST the list + details to the backend.
  const fetchAndSend = useCallback(async () => {
    setBusy(true);
    try {
      const inStore = listRef.current.filter((i) => !i.IsOnlineOrder);
      if (inStore.length && !storeRef.current) {
        setStatus("Couldn't read your store number — reload the purchases page and try again.");
        setBusy(false);
        return;
      }
      for (let i = 0; i < inStore.length; i++) {
        setStatus(`Getting items… in-store receipt ${i + 1}/${inStore.length}`);
        const url = publixDetailUrl(storeRef.current, inStore[i]);
        webRef.current?.injectJavaScript(`window.location.href=${JSON.stringify(url)}; true;`);
        await new Promise<void>((resolve) => {
          detailWaiter.current = resolve;
          setTimeout(() => {
            if (detailWaiter.current) {
              detailWaiter.current = null;
              resolve();
            }
          }, 9000);
        });
      }

      setStatus("Sending to receiptly…");
      const res = await fetch(`${API_URL}/api/connectors/publix/raw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ list: listRef.current, details: detailsRef.current }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        receipts?: number;
        matched?: number;
        total?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Backend rejected the receipts.");
      setResult(`✅ Sent ${data.receipts ?? 0} receipts · ${data.matched ?? 0}/${data.total ?? 0} matched to your charges.`);
      setScreen("home");
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const startConnect = () => {
    listRef.current = [];
    detailsRef.current = [];
    storeRef.current = "";
    setList([]);
    setResult(null);
    setStatus("Log in to Publix above — your purchases will appear.");
    setScreen("connect");
  };

  if (screen === "home") {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <View style={styles.home}>
          <Text style={styles.logo}>🧾 receiptly</Text>
          <Text style={styles.tagline}>
            Itemized receipts from your real account — you log in on your phone, so it just works.
          </Text>

          <Pressable style={styles.primaryBtn} onPress={startConnect}>
            <Text style={styles.primaryBtnText}>🛒  Connect Publix</Text>
          </Pressable>

          {result && <Text style={styles.result}>{result}</Text>}
          <Text style={styles.hint}>View everything in the dashboard at {API_URL.replace(/^https?:\/\//, "")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.topbar}>
        <Pressable onPress={() => setScreen("home")} hitSlop={8}>
          <Text style={styles.back}>✕</Text>
        </Pressable>
        <Text style={styles.title}>Connect Publix</Text>
        <View style={{ width: 22 }} />
      </View>

      <WebView
        ref={webRef}
        source={{ uri: PUBLIX_URL }}
        injectedJavaScriptBeforeContentLoaded={PUBLIX_INJECT}
        onMessage={onMessage}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        style={{ flex: 1 }}
      />

      <View style={styles.bottombar}>
        <Text style={styles.status} numberOfLines={2}>
          {status}
        </Text>
        <Pressable
          style={[styles.primaryBtn, (busy || list.length === 0) && styles.btnDisabled]}
          disabled={busy || list.length === 0}
          onPress={fetchAndSend}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>
              {list.length ? `Get items & send (${list.length})` : "Waiting for purchases…"}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#faf6ee" },
  home: { flex: 1, padding: 28, justifyContent: "center", gap: 18 },
  logo: { fontSize: 30, fontWeight: "700", color: INK },
  tagline: { fontSize: 16, color: MUTED, lineHeight: 22 },
  primaryBtn: {
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingVertical: 16,
    paddingHorizontal: 22,
    alignItems: "center",
    shadowColor: GREEN_DEEP,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  btnDisabled: { opacity: 0.5 },
  result: { fontSize: 15, color: GREEN_DEEP, fontWeight: "600" },
  hint: { fontSize: 13, color: MUTED },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: CREAM,
  },
  back: { fontSize: 20, color: INK, width: 22 },
  title: { fontSize: 16, fontWeight: "700", color: INK },
  bottombar: { padding: 16, gap: 12, borderTopWidth: 1, borderTopColor: CREAM, backgroundColor: "#fff" },
  status: { fontSize: 14, color: MUTED },
});
