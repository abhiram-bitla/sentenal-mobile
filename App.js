import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

const API_BASE_URL = "http://127.0.0.1:3001";
const COGNITO_REGION = "us-east-2";
const COGNITO_CLIENT_ID = "3npppr0t7p9ulpttpq2p3s0g6c";
const COGNITO_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
const STARTER_MESSAGES = [
  {
    id: "starter-sentenal-host",
    text: "Welcome in. This is the public room, so say what's on your radar.",
    userAlias: "Sentenal Host",
    userEmail: "sentenal@sentenal.news",
    createdAt: "2026-04-22T12:00:00.000Z"
  },
  {
    id: "starter-night-watch",
    text: "Anyone else tracking how fast the app is changing? Feels like a tiny newsroom in here.",
    userAlias: "Night Watch",
    userEmail: "night-watch@sentenal.news",
    createdAt: "2026-04-22T12:01:00.000Z"
  },
  {
    id: "starter-question",
    text: "First question: what should Sentenal cover or build next?",
    userAlias: "Forum Prompt",
    userEmail: "forum@sentenal.news",
    createdAt: "2026-04-22T12:02:00.000Z"
  }
];

export default function App() {
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [message, setMessage] = useState("");
  const [screen, setScreen] = useState("entry");
  const [savedEmail, setSavedEmail] = useState("");
  const [savedAlias, setSavedAlias] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newsletterSynced, setNewsletterSynced] = useState(false);
  const [newsletterSyncing, setNewsletterSyncing] = useState(false);
  const displayMessages = messages.length ? messages : STARTER_MESSAGES;

  useEffect(() => {
    if (!savedEmail) {
      setMessages([]);
      return undefined;
    }

    loadMessages(savedEmail);
    const intervalId = setInterval(() => {
      loadMessages(savedEmail);
    }, 3000);

    return () => clearInterval(intervalId);
  }, [savedEmail]);

  useEffect(() => {
    if (!savedEmail || newsletterSynced || newsletterSyncing) {
      return undefined;
    }

    let cancelled = false;

    async function syncNewsletterSignup() {
      setNewsletterSyncing(true);

      try {
        const cognitoUsername = buildCognitoUsername(savedEmail);
        await cognitoRequest("SignUp", {
          ClientId: COGNITO_CLIENT_ID,
          Username: cognitoUsername,
          Password: buildRandomPassword(),
          UserAttributes: [
            {
              Name: "email",
              Value: savedEmail
            }
          ]
        });

        if (!cancelled) {
          setNewsletterSynced(true);
        }
      } catch (error) {
        if (
          error.message.includes("UsernameExistsException") ||
          error.message.includes("An account with the given email already exists")
        ) {
          if (!cancelled) {
            setNewsletterSynced(true);
          }
        }
      } finally {
        if (!cancelled) {
          setNewsletterSyncing(false);
        }
      }
    }

    syncNewsletterSignup();
    const retryId = setInterval(syncNewsletterSignup, 5000);

    return () => {
      cancelled = true;
      clearInterval(retryId);
    };
  }, [newsletterSynced, newsletterSyncing, savedEmail]);

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.email
          ? {
              "X-User-Email": options.email
            }
          : {}),
        ...(options.alias
          ? {
              "X-User-Alias": options.alias
            }
          : {}),
        ...(options.token
          ? {
              Authorization: `Bearer ${options.token}`
            }
          : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Something went wrong.");
    }

    return data;
  }

  async function cognitoRequest(target, body) {
    const response = await fetch(COGNITO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Cognito request failed.");
    }

    return data;
  }

  async function loadMessages(nextEmail = savedEmail, nextAlias = savedAlias) {
    try {
      const data = await request("/api/messages", {
        email: nextEmail,
        alias: nextAlias
      });
      setMessages(data.messages);
    } catch (_error) {
      // Keep the current chat view responsive even if the refresh fails.
    }
  }

  function buildRandomPassword() {
    const randomPart = Math.random().toString(36).slice(2);
    return `A1!forum-${Date.now()}-${randomPart}`;
  }

  function buildCognitoUsername(value) {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const suffix = `${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    return `lead-${normalized || "guest"}-${suffix}`;
  }

  function buildAnonymousName(value) {
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }

    return `Anon ${Math.floor(1000 + Math.random() * 9000)}`;
  }

  function buildStorageEmail(value) {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      return `guest-${Date.now()}@sentenal.news`;
    }

    if (trimmed.includes("@")) {
      return trimmed;
    }

    const slug = trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `${slug || `guest-${Date.now()}`}@sentenal.news`;
  }

  async function handleEmailSubmit() {
    setLoading(true);
    const nextAlias = buildAnonymousName(alias);
    const nextEmail = buildStorageEmail(email);

    setNewsletterSynced(false);
    setNewsletterSyncing(false);
    setSavedAlias(nextAlias);
    setSavedEmail(nextEmail);
    setEmail("");
    setAlias("");
    setScreen("chat");
    setLoading(false);
  }

  async function handleSendMessage() {
    if (!message.trim()) {
      return;
    }

    const optimisticMessage = {
      id: `local-${Date.now()}`,
      text: message.trim(),
      userAlias: savedAlias,
      userEmail: savedEmail,
      createdAt: new Date().toISOString()
    };

    setMessages((current) => [...current, optimisticMessage].slice(-100));
    setMessage("");

    try {
      await request("/api/messages", {
        method: "POST",
        email: savedEmail,
        alias: savedAlias,
        body: { text: optimisticMessage.text }
      });
      loadMessages(savedEmail, savedAlias);
    } catch (_error) {
      // Keep the local chat flow uninterrupted even if the post fails.
    }
  }

  function resetEmail() {
    setScreen("entry");
    setSavedEmail("");
    setSavedAlias("");
    setNewsletterSynced(false);
    setNewsletterSyncing(false);
    setMessages([]);
    setMessage("");
  }

  if (screen !== "chat") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.screen}
        >
          <View style={styles.hero}>
            <View style={styles.brandRow}>
              <View style={styles.logoWrap}>
                <Image
                  source={require("./assets/icon.png")}
                  style={styles.logo}
                  resizeMode="cover"
                />
              </View>
              <Text style={styles.eyebrow}>Sentenal Live</Text>
            </View>
            <Text style={styles.title}>Sign up for the newsletter. Then jump into chat.</Text>
            <Text style={styles.subtitle}>
              Pick any email, choose an anonymous name, and we will drop you
              straight into the public room.
            </Text>
          </View>

          <View style={styles.card}>
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Email for the newsletter"
              placeholderTextColor="#897e74"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              autoCapitalize="words"
              placeholder="Anonymous name"
              placeholderTextColor="#897e74"
              style={styles.input}
              value={alias}
              onChangeText={setAlias}
            />
            <Pressable style={styles.primaryButton} onPress={handleEmailSubmit}>
              {loading ? (
                <ActivityIndicator color="#fff8f0" />
              ) : (
                <Text style={styles.primaryButtonText}>Join newsletter and chat</Text>
              )}
            </Pressable>
            <Text style={styles.helperText}>
              Your anonymous name is what everyone sees. The app keeps moving and
              opens chat right away.
            </Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.screen}
      >
        <View style={styles.chatHeader}>
          <View>
            <Text style={styles.eyebrow}>Chatting as</Text>
            <Text style={styles.userEmail}>{savedAlias}</Text>
            <Text style={styles.helperText}>{savedEmail}</Text>
          </View>
          <Pressable onPress={resetEmail} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Start over</Text>
          </Pressable>
        </View>

        <FlatList
          data={displayMessages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          renderItem={({ item }) => (
            <View style={styles.messageCard}>
              <Text style={styles.messageAuthor}>{item.userAlias || item.userEmail}</Text>
              <Text style={styles.messageBody}>{item.text}</Text>
              <Text style={styles.messageMeta}>
                {new Date(item.createdAt).toLocaleString()}
              </Text>
            </View>
          )}
        />

        <View style={styles.composer}>
          <TextInput
            placeholder="Write to the public forum..."
            placeholderTextColor="#897e74"
            style={styles.input}
            value={message}
            onChangeText={setMessage}
          />
          <Pressable style={styles.primaryButton} onPress={handleSendMessage}>
            <Text style={styles.primaryButtonText}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#ff1a1a"
  },
  screen: {
    flex: 1,
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: "#ff1a1a"
  },
  hero: {
    paddingTop: 18,
    marginBottom: 18
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10
  },
  logoWrap: {
    width: 54,
    height: 54,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#ffca08"
  },
  logo: {
    width: "100%",
    height: "100%"
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: "#ffe082"
  },
  title: {
    fontSize: 38,
    lineHeight: 40,
    fontWeight: "800",
    color: "#fff6e0",
    marginBottom: 12
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: "#ffd6a6",
    maxWidth: 320
  },
  card: {
    backgroundColor: "#fff1d6",
    borderRadius: 26,
    padding: 18,
    borderWidth: 1,
    borderColor: "#ffca08",
    gap: 12,
    shadowColor: "#7a1800",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 6
  },
  input: {
    backgroundColor: "#fff9ef",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#ffcf5a",
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 16,
    color: "#1f1914"
  },
  primaryButton: {
    backgroundColor: "#ffca08",
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: "center"
  },
  primaryButtonText: {
    color: "#6a1200",
    fontSize: 16,
    fontWeight: "700"
  },
  secondaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ffcf5a",
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  secondaryButtonText: {
    color: "#fff4d8",
    fontWeight: "700"
  },
  statusText: {
    color: "#7b5d48",
    fontSize: 14
  },
  linkText: {
    color: "#9f4c2e",
    fontWeight: "700"
  },
  helperText: {
    color: "#8a3e00",
    lineHeight: 20
  },
  chatHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 14
  },
  userEmail: {
    fontSize: 24,
    fontWeight: "800",
    color: "#fff5dd"
  },
  messageList: {
    gap: 12,
    paddingBottom: 18
  },
  messageCard: {
    backgroundColor: "#fff1d6",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#ffcf5a",
    padding: 16
  },
  messageAuthor: {
    fontSize: 14,
    fontWeight: "800",
    color: "#a53600",
    marginBottom: 6
  },
  messageBody: {
    fontSize: 16,
    lineHeight: 23,
    color: "#2f241d",
    marginBottom: 8
  },
  messageMeta: {
    fontSize: 12,
    color: "#9a6d3b"
  },
  composer: {
    gap: 10,
    paddingTop: 8
  }
});
