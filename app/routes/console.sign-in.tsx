import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import PriceifyIcon from "../components/public/priceify/PriceifyIcon";
import StaffOtpBoxes from "../components/public/priceify/StaffOtpBoxes";
import { useHydrated } from "../hooks/useHydrated";
import { useKeyedState } from "../hooks/useKeyedState";
import {
  clearStaffOtpDraft,
  formatOtpCountdown,
  maskStaffEmail,
  readStaffOtpDraft,
  secondsLeftFromIssued,
  writeStaffOtpDraft,
} from "../components/public/priceify/staffOtp";
import {
  CONSOLE_SIGN_IN_PATH,
  assertSameOrigin,
  clearConsoleSignInFailures,
  consoleNextTicketId,
  consoleSignInBlocked,
  endConsoleSession,
  isConsoleSignInConfigured,
  recordConsoleSignInFailure,
  requestConsoleSignInCode,
  safeConsoleNext,
  startConsoleSession,
  verifyConsoleSignInCode,
} from "../utils/consoleAuth.server";

export const meta: MetaFunction = () => [{ title: "Sign in · Priceify Console" }];

const NOT_CONFIGURED = "Priceify Console is not configured on this server.";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const next = safeConsoleNext(new URL(request.url).searchParams.get("next"));
  return {
    next,
    ticketId: consoleNextTicketId(next),
    configured: isConsoleSignInConfigured(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  assertSameOrigin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  if (intent === "logout") {
    const next = safeConsoleNext(form.get("next"));
    const signIn =
      next === "/console/tickets"
        ? CONSOLE_SIGN_IN_PATH
        : `${CONSOLE_SIGN_IN_PATH}?next=${encodeURIComponent(next)}`;
    return redirect(signIn, {
      headers: { "Set-Cookie": await endConsoleSession(request) },
    });
  }

  const next = safeConsoleNext(form.get("next"));
  const email = String(form.get("email") || "");
  if (!isConsoleSignInConfigured()) {
    return { error: NOT_CONFIGURED, step: "email" as const };
  }
  if (consoleSignInBlocked(request)) {
    return {
      error: "Too many failed sign-in attempts. Try again in a few minutes.",
      step: "email" as const,
      email,
    };
  }
  if (intent === "reset") {
    return { step: "email" as const, email };
  }
  const issued = String(form.get("issued") || "");
  const notice = String(form.get("notice") || "");
  if (intent === "send") {
    const result = await requestConsoleSignInCode(email);
    const fromCodeStep = form.has("code");
    if (!result.ok) {
      return {
        error: result.error,
        step: fromCodeStep && (result.email || email) ? ("code" as const) : ("email" as const),
        email: result.email || email,
        issued: fromCodeStep ? issued : "",
        message: fromCodeStep ? notice : "",
      };
    }
    return {
      step: "code" as const,
      email: result.email,
      message: result.message,
      issued: String(Date.now()),
    };
  }
  if (intent === "verify") {
    const code = String(form.get("code") || "").replace(/\D/g, "");
    if (code.length !== 6) {
      return {
        error: "Enter the 6-digit code from your email.",
        step: "code" as const,
        email,
        issued,
        message: notice,
      };
    }
    const payload = await verifyConsoleSignInCode(email, code);
    if (!payload?.member) {
      recordConsoleSignInFailure(request);
      return {
        error: "Invalid or expired code. Request a new code.",
        step: "code" as const,
        email,
        issued,
        message: notice,
      };
    }
    clearConsoleSignInFailures(request);
    const cookie = await startConsoleSession(request, payload.member).catch(() => null);
    if (!cookie) {
      return {
        error: "Could not start a console session. Try again.",
        step: "code" as const,
        email,
        issued,
        message: notice,
      };
    }
    return redirect(next, {
      headers: { "Set-Cookie": cookie },
    });
  }
  return { error: "Choose an action.", step: "email" as const, email };
};

function useOtpCountdown(resetKey: string, issued: string) {
  const [left, setLeft] = useState(() => secondsLeftFromIssued(issued));

  useEffect(() => {
    const tick = () => setLeft(secondsLeftFromIssued(issued));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [resetKey, issued]);

  return left;
}

function StaffOtpTimer({ left }: { left: number }) {
  if (left > 0) {
    return (
      <p className="staff-otp-timer" aria-hidden="true">
        Code expires in {formatOtpCountdown(left)}
      </p>
    );
  }
  return (
    <p className="staff-otp-timer staff-otp-timer--expired" role="alert">
      Code expired. Request a new one.
    </p>
  );
}

export default function ConsoleSignIn() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const hydrated = useHydrated();
  const actionResult = actionData && "step" in actionData ? actionData : null;
  const actionStep = actionResult?.step || null;
  // The saved draft lets a reload land back on the code step. It only matters
  // before a form action has run — after that the action result says which step
  // we are on — and it lives in browser storage, so it is read after hydration
  // rather than mirrored into state. Reading it once per step keeps a verify
  // that clears storage mid-flight from dropping the form back to the email
  // step while the redirect is still in progress.
  const draft = useMemo(
    () => (!actionStep && hydrated ? readStaffOtpDraft() : null),
    [actionStep, hydrated]
  );
  const step = actionStep === "code" || (!actionStep && draft) ? "code" : "email";
  const email = actionStep
    ? String((actionResult && "email" in actionResult && actionResult.email) || "")
    : String(draft?.email || "");
  const issued = actionStep === "code"
    ? String((actionResult && "issued" in actionResult && actionResult.issued) || "")
    : actionStep
      ? ""
      : String(draft?.issued || "");
  const message = actionStep === "code"
    ? (actionResult && "message" in actionResult && actionResult.message) || ""
    : actionStep
      ? ""
      : draft?.message || "";
  const otpResetKey = step === "code" ? `${email}:${issued || message}` : "idle";
  const otpLeft = useOtpCountdown(otpResetKey, issued);
  // A newly issued code clears whatever was typed against the previous one.
  const [codeDigits, setCodeDigits] = useKeyedState(otpResetKey, "");
  const intent = String(navigation.formData?.get("intent") || "");
  const sentTo = maskStaffEmail(email);

  useEffect(() => {
    if (actionStep === "code") {
      writeStaffOtpDraft({ email, issued, message });
      return;
    }
    if (actionStep === "email") clearStaffOtpDraft();
  }, [actionStep, email, issued, message]);

  useEffect(() => {
    if (navigation.state === "loading" && intent === "verify") clearStaffOtpDraft();
  }, [intent, navigation.state]);

  return (
    <section className="staff-auth">
      <div className="staff-auth-copy">
        <p className="px-eyebrow">Priceify Console</p>
        <h1 className="staff-title">Team sign-in</h1>
        <p className="staff-lead">
          For the Priceify team. We email a 6-digit code to your @echologyx.com address. This is
          not a merchant Shopify login.
        </p>
        <ul className="staff-points">
          <li>
            <PriceifyIcon name="icon-shield" size={20} />
            <span>Only team members added by an owner can sign in.</span>
          </li>
          <li>
            <PriceifyIcon name="icon-sparkles" size={20} />
            <span>The code expires in 1 minute. Your session is yours alone.</span>
          </li>
          <li>
            <PriceifyIcon name="icon-lifebuoy" size={20} />
            <span>Reply to tickets, check stores and their plans.</span>
          </li>
        </ul>
      </div>

      <div className="px-card staff-auth-card">
        <p className="staff-card-kicker">{step === "code" ? "Confirm code" : "Work email"}</p>
        <h2 className="staff-card-title">
          {step === "code" ? "Enter the 6-digit code" : "Request a sign-in code"}
        </h2>
        {!data.configured ? (
          <p className="staff-error" role="alert">
            {NOT_CONFIGURED}
          </p>
        ) : null}
        {actionData && "error" in actionData && actionData.error ? (
          <p className="staff-error" role="alert">
            {actionData.error}
          </p>
        ) : null}
        {message ? (
          <p className="staff-success" aria-live="polite">
            {message}
          </p>
        ) : null}
        {step === "code" && sentTo ? <p className="staff-hint">Sent to {sentTo}.</p> : null}
        {data.ticketId ? (
          <p className="staff-hint">
            After sign-in you will open {data.ticketId}. That thread is only visible to that shop
            in Admin Help.
          </p>
        ) : null}

        {step === "code" ? (
          <>
          <Form method="post" action="/console/sign-in" className="staff-form">
            <input type="hidden" name="next" value={data.next} />
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="issued" value={issued} />
            <input type="hidden" name="notice" value={message || ""} />
            <StaffOtpBoxes
              key={otpResetKey}
              disabled={!data.configured || busy}
              onDigitsChange={setCodeDigits}
            />
            <StaffOtpTimer left={otpLeft} />
            <div className="staff-actions">
              <button
                className="px-btn px-btn--brand staff-btn-block"
                type="submit"
                name="intent"
                value="verify"
                disabled={!data.configured || busy || codeDigits.length !== 6}
              >
                {busy && intent === "verify"
                  ? "Checking…"
                  : data.ticketId
                    ? `Open ${data.ticketId}`
                    : "Sign in"}
              </button>
              <StaffResendButton configured={data.configured} busy={busy} left={otpLeft} />
            </div>
          </Form>
          <Form method="post" action="/console/sign-in" className="staff-reset-form">
            <input type="hidden" name="next" value={data.next} />
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="intent" value="reset" />
            <button className="staff-text-btn" type="submit" disabled={busy}>
              Use a different email
            </button>
          </Form>
          </>
        ) : (
          <Form method="post" action="/console/sign-in" className="staff-form">
            <input type="hidden" name="next" value={data.next} />
            <input type="hidden" name="intent" value="send" />
            <label className="staff-label" htmlFor="staff-email">
              Work email
            </label>
            <input
              id="staff-email"
              className="staff-input"
              name="email"
              type="email"
              autoComplete="email"
              spellCheck={false}
              required
              defaultValue={email}
              disabled={!data.configured || busy}
              placeholder="you@echologyx.com"
            />
            <div className="staff-actions">
              <button
                className="px-btn px-btn--brand staff-btn-block"
                type="submit"
                disabled={!data.configured || busy}
              >
                {busy ? "Sending…" : "Email me a code"}
              </button>
            </div>
          </Form>
        )}
      </div>
    </section>
  );
}

function StaffResendButton({
  configured,
  busy,
  left,
}: {
  configured: boolean;
  busy: boolean;
  left: number;
}) {
  return (
    <button
      className="px-btn px-btn--ghost staff-btn-block"
      type="submit"
      name="intent"
      value="send"
      disabled={!configured || busy || left > 0}
    >
      {left > 0 ? `Resend in ${formatOtpCountdown(left)}` : busy ? "Sending…" : "Resend code"}
    </button>
  );
}
