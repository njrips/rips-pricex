import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import PricifyIcon from "../components/public/pricify/PricifyIcon";
import StaffOtpBoxes from "../components/public/pricify/StaffOtpBoxes";
import {
  clearStaffOtpDraft,
  formatOtpCountdown,
  maskStaffEmail,
  readStaffOtpDraft,
  secondsLeftFromIssued,
  writeStaffOtpDraft,
} from "../components/public/pricify/staffOtp";
import {
  clearStaffLoginFailures,
  isStaffLoginConfigured,
  recordStaffLoginFailure,
  requestStaffLoginCode,
  safeStaffNext,
  staffClearCookieHeader,
  staffLoginBlocked,
  staffNextTicketId,
  staffSetCookieHeader,
  verifyStaffLoginCode,
} from "../utils/staffSupportAuth.server";

export const meta: MetaFunction = () => [{ title: "Staff login · Pricify" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const next = safeStaffNext(new URL(request.url).searchParams.get("next"));
  return {
    next,
    ticketId: staffNextTicketId(next),
    configured: isStaffLoginConfigured(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  if (intent === "logout") {
    const next = safeStaffNext(form.get("next"));
    const login =
      next === "/staff/support" ? "/staff/login" : `/staff/login?next=${encodeURIComponent(next)}`;
    return redirect(login, {
      headers: { "Set-Cookie": staffClearCookieHeader(request) },
    });
  }

  const next = safeStaffNext(form.get("next"));
  const email = String(form.get("email") || "");
  if (!isStaffLoginConfigured()) {
    return { error: "Staff support is not configured on this server.", step: "email" as const };
  }
  if (staffLoginBlocked(request)) {
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
    const result = await requestStaffLoginCode(email);
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
    const payload = await verifyStaffLoginCode(email, code);
    if (!payload) {
      recordStaffLoginFailure(request);
      return {
        error: "Invalid or expired code. Request a new code.",
        step: "code" as const,
        email,
        issued,
        message: notice,
      };
    }
    clearStaffLoginFailures(request);
    const cookie = staffSetCookieHeader(request);
    if (!cookie) {
      return {
        error: "Could not start a staff session.",
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

export default function StaffLogin() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [draft, setDraft] = useState<null | { email: string; issued: string; message: string }>(
    null,
  );
  const actionStep = actionData && "step" in actionData ? actionData.step : null;
  const step = actionStep === "code" || (!actionStep && draft) ? "code" : "email";
  const email = actionStep
    ? String(("email" in actionData && actionData.email) || "")
    : String(draft?.email || "");
  const issued = actionStep === "code"
    ? String(("issued" in actionData && actionData.issued) || "")
    : actionStep
      ? ""
      : String(draft?.issued || "");
  const message = actionStep === "code"
    ? ("message" in actionData && actionData.message) || ""
    : actionStep
      ? ""
      : draft?.message || "";
  const otpResetKey = step === "code" ? `${email}:${issued || message}` : "idle";
  const otpLeft = useOtpCountdown(otpResetKey, issued);
  const [codeDigits, setCodeDigits] = useState("");
  const intent = String(navigation.formData?.get("intent") || "");
  const sentTo = maskStaffEmail(email);

  useEffect(() => {
    setDraft(readStaffOtpDraft());
  }, []);

  useEffect(() => {
    if (actionStep === "code") {
      writeStaffOtpDraft({ email, issued, message });
      setDraft({ email, issued, message: String(message || "") });
      return;
    }
    if (actionStep === "email") {
      clearStaffOtpDraft();
      setDraft(null);
    }
  }, [actionStep, email, issued, message]);

  useEffect(() => {
    if (navigation.state === "loading" && intent === "verify") {
      clearStaffOtpDraft();
      setDraft(null);
    }
  }, [intent, navigation.state]);

  useEffect(() => {
    setCodeDigits("");
  }, [otpResetKey]);

  return (
    <section className="staff-auth">
      <div className="staff-auth-copy">
        <p className="px-eyebrow">Staff</p>
        <h1 className="staff-title">Sign in to the operator queue</h1>
        <p className="staff-lead">
          We email a 6-digit sign-in code to a verified @echologyx.com address. This is not a
          merchant Shopify login.
        </p>
        <ul className="staff-points">
          <li>
            <PricifyIcon name="icon-shield" size={20} />
            <span>Only verified Echologyx emails can request a code.</span>
          </li>
          <li>
            <PricifyIcon name="icon-sparkles" size={20} />
            <span>The code expires in 1 minute, same as RipX.</span>
          </li>
          <li>
            <PricifyIcon name="icon-lifebuoy" size={20} />
            <span>After sign-in you can review and reply to shop tickets.</span>
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
            Staff support is not configured on this server.
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
          <Form method="post" action="/staff/login" className="staff-form">
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
                    : "Open queue"}
              </button>
              <StaffResendButton configured={data.configured} busy={busy} left={otpLeft} />
            </div>
          </Form>
          <Form method="post" action="/staff/login" className="staff-reset-form">
            <input type="hidden" name="next" value={data.next} />
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="intent" value="reset" />
            <button className="staff-text-btn" type="submit" disabled={busy}>
              Use a different email
            </button>
          </Form>
          </>
        ) : (
          <Form method="post" action="/staff/login" className="staff-form">
            <input type="hidden" name="next" value={data.next} />
            <input type="hidden" name="intent" value="send" />
            <label className="staff-label" htmlFor="staff-email">
              Echologyx email
            </label>
            <input
              id="staff-email"
              className="staff-input"
              name="email"
              type="email"
              autoComplete="email"
              spellCheck={false}
              autoFocus
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
