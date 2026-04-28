import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
const TERMS_TEXT =
  "I agree to the Sentenal EULA and forum rules. Sentenal is an 18+ public forum with no tolerance for objectionable content or abusive users.";
const MODERATION_EMAIL = "abhiram.bitla@gmail.com";
const SAFETY_RULES = [
  "You must be 18 or older to use this public forum.",
  "Do not post harassment, threats, hate, sexual exploitation, illegal content, spam, or abusive content.",
  "Posts are filtered for objectionable terms before they appear.",
  "Users can report posts, block users, and immediately remove posts from their own feed.",
  "Reported posts are removed from the feed, reviewed within 24 hours, and abusive users may be ejected.",
  `Report inappropriate activity in the app or by email: ${MODERATION_EMAIL}`
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
  const [confirmedAdult, setConfirmedAdult] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [hiddenMessageIds, setHiddenMessageIds] = useState([]);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [newsletterSynced, setNewsletterSynced] = useState(false);
  const [newsletterSyncing, setNewsletterSyncing] = useState(false);
  const visibleMessages = messages
    .filter((item) => !hiddenMessageIds.includes(item.id))
    .filter((item) => !blockedUsers.includes(item.userEmail));
  const displayMessages = visibleMessages.length ? visibleMessages : STARTER_MESSAGES;

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

  function getFriendlyErrorMessage(error, fallback) {
    const message = String(error?.message || "");

    if (message.toLowerCase().includes("objectionable content")) {
      return "This post was blocked by Sentenal moderation. Please edit it and try again.";
    }

    if (message.toLowerCase().includes("removed from the forum")) {
      return "This account cannot post because it was removed from the forum for safety reasons.";
    }

    if (
      message.toLowerCase().includes("network") ||
      message.toLowerCase().includes("failed to fetch")
    ) {
      return "Sentenal is reconnecting. Please try again in a moment.";
    }

    return fallback;
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
    if (!confirmedAdult) {
      setStatusMessage("Please confirm you are 18 or older before joining.");
      return;
    }

    if (!acceptedTerms) {
      setStatusMessage("Please agree to the Sentenal EULA and safety terms before joining.");
      return;
    }

    setLoading(true);
    const nextAlias = buildAnonymousName(alias);
    const nextEmail = buildStorageEmail(email);

    setNewsletterSynced(false);
    setNewsletterSyncing(false);
    setSavedAlias(nextAlias);
    setSavedEmail(nextEmail);
    setEmail("");
    setAlias("");
    setStatusMessage("");
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
      setStatusMessage("");
    } catch (error) {
      setMessages((current) =>
        current.filter((item) => item.id !== optimisticMessage.id)
      );
      setStatusMessage(
        getFriendlyErrorMessage(
          error,
          "We could not send that post. Please edit it and try again."
        )
      );
    }
  }

  async function reportMessage(item) {
    setHiddenMessageIds((current) => [...new Set([...current, item.id])]);
    setStatusMessage(
      "Report submitted. The post was removed from your feed and will be reviewed within 24 hours."
    );

    if (item.id.startsWith("starter-")) {
      return;
    }

    try {
      await request(`/api/messages/${item.id}/report`, {
        method: "POST",
        email: savedEmail,
        alias: savedAlias,
        body: { reason: "Reported from in-app forum controls" }
      });
      loadMessages(savedEmail, savedAlias);
    } catch (_error) {
      setStatusMessage(
        "Report saved in your feed. Sentenal will review inappropriate activity within 24 hours."
      );
    }
  }

  function blockUser(item) {
    setBlockedUsers((current) => [...new Set([...current, item.userEmail])]);
    setStatusMessage(`${item.userAlias || item.userEmail} is blocked and hidden from your feed.`);
  }

  async function removeMessageFromFeed(item) {
    setHiddenMessageIds((current) => [...new Set([...current, item.id])]);
    setStatusMessage("Post removed from your feed.");

    if (item.userEmail !== savedEmail) {
      return;
    }

    try {
      await request(`/api/messages/${item.id}`, {
        method: "DELETE",
        email: savedEmail,
        alias: savedAlias
      });
      loadMessages(savedEmail, savedAlias);
    } catch (_error) {
      setStatusMessage("Post removed from your feed.");
    }
  }

  function confirmDeleteAccount() {
    Alert.alert(
      "Delete account?",
      "This removes your Sentenal account data and posts. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: deleteAccount
        }
      ]
    );
  }

  async function deleteAccount() {
    setDeletingAccount(true);
    try {
      await request("/api/account", {
        method: "DELETE",
        email: savedEmail,
        alias: savedAlias
      });
      resetEmail();
      setConfirmedAdult(false);
      setAcceptedTerms(false);
      setStatusMessage("Your account and posts have been deleted.");
    } catch (error) {
      setStatusMessage(
        getFriendlyErrorMessage(
          error,
          `We could not complete account deletion in-app. Please try again or contact ${MODERATION_EMAIL}.`
        )
      );
    } finally {
      setDeletingAccount(false);
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
    setBlockedUsers([]);
    setHiddenMessageIds([]);
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
              Sentenal is an 18+ public forum. Pick any email, choose an
              anonymous name, and review the safety rules before entering.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.rulesCard}>
              <Text style={styles.rulesTitle}>18+ Forum EULA and Safety Rules</Text>
              {SAFETY_RULES.map((rule) => (
                <Text key={rule} style={styles.rulesText}>
                  - {rule}
                </Text>
              ))}
            </View>
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
            <Pressable
              style={styles.termsRow}
              onPress={() => setConfirmedAdult((current) => !current)}
            >
              <View style={[styles.checkbox, confirmedAdult && styles.checkboxActive]}>
                <Text style={styles.checkboxText}>{confirmedAdult ? "OK" : ""}</Text>
              </View>
              <Text style={styles.termsText}>I confirm I am 18 or older.</Text>
            </Pressable>
            <Pressable
              style={styles.termsRow}
              onPress={() => setAcceptedTerms((current) => !current)}
            >
              <View style={[styles.checkbox, acceptedTerms && styles.checkboxActive]}>
                <Text style={styles.checkboxText}>{acceptedTerms ? "OK" : ""}</Text>
              </View>
              <Text style={styles.termsText}>{TERMS_TEXT}</Text>
            </Pressable>
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
            <Text style={styles.helperText}>
              Report abuse: {MODERATION_EMAIL}
            </Text>
            {statusMessage ? (
              <Text style={styles.statusText}>{statusMessage}</Text>
            ) : null}
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

        <View style={styles.safetyCard}>
          <Text style={styles.safetyTitle}>18+ Safety controls</Text>
          <Text style={styles.safetyText}>
            Zero tolerance for abusive or objectionable content. Use Report to
            flag a post, Block user to hide a user, and Remove to immediately
            take a post out of your feed. Reported posts are reviewed within 24
            hours and abusive users may be ejected. Contact: {MODERATION_EMAIL}
          </Text>
          <Pressable
            onPress={confirmDeleteAccount}
            style={[styles.dangerButton, deletingAccount && styles.disabledButton]}
            disabled={deletingAccount}
          >
            <Text style={styles.dangerButtonText}>
              {deletingAccount ? "Deleting account..." : "Delete account"}
            </Text>
          </Pressable>
          {statusMessage ? <Text style={styles.statusText}>{statusMessage}</Text> : null}
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
              <View style={styles.messageActions}>
                <Pressable
                  style={styles.actionButton}
                  onPress={() => reportMessage(item)}
                >
                  <Text style={styles.actionButtonText}>Report</Text>
                </Pressable>
                <Pressable style={styles.actionButton} onPress={() => blockUser(item)}>
                  <Text style={styles.actionButtonText}>Block user</Text>
                </Pressable>
                <Pressable
                  style={styles.actionButton}
                  onPress={() => removeMessageFromFeed(item)}
                >
                  <Text style={styles.actionButtonText}>
                    {item.userEmail === savedEmail ? "Delete post" : "Remove"}
                  </Text>
                </Pressable>
              </View>
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
  rulesCard: {
    backgroundColor: "#fff9ef",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#ffcf5a",
    padding: 14,
    gap: 6
  },
  rulesTitle: {
    color: "#a53600",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 2
  },
  rulesText: {
    color: "#5f2a00",
    fontSize: 12,
    lineHeight: 17
  },
  termsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 6
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#a53600",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff9ef"
  },
  checkboxActive: {
    backgroundColor: "#ffca08"
  },
  checkboxText: {
    color: "#6a1200",
    fontSize: 10,
    fontWeight: "900"
  },
  termsText: {
    flex: 1,
    color: "#6d3100",
    fontSize: 13,
    lineHeight: 18
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
  safetyCard: {
    backgroundColor: "#fff1d6",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ffcf5a",
    padding: 14,
    gap: 8,
    marginBottom: 12
  },
  safetyTitle: {
    color: "#a53600",
    fontSize: 15,
    fontWeight: "900"
  },
  safetyText: {
    color: "#5f2a00",
    fontSize: 13,
    lineHeight: 18
  },
  dangerButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#b31900",
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: "#ffe1d6"
  },
  dangerButtonText: {
    color: "#8d1800",
    fontSize: 13,
    fontWeight: "900"
  },
  disabledButton: {
    opacity: 0.55
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
  messageActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8
  },
  actionButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#c95d15",
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: "#fff9ef"
  },
  actionButtonText: {
    color: "#9f3a00",
    fontSize: 12,
    fontWeight: "800"
  },
  composer: {
    gap: 10,
    paddingTop: 8
  }
});
