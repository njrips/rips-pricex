import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { supportErrorMessage } from "../utils/expressSupportApi.server";
import {
  assertSameOrigin,
  consoleApiFetch,
  requireConsoleMember,
} from "../utils/consoleAuth.server";
import {
  consoleActionLabel,
  formatConsoleDateTime,
} from "../components/public/priceify/consoleStores";

export const meta: MetaFunction = () => [{ title: "Team · Priceify Console" }];

type Member = {
  id: number;
  email: string;
  displayName?: string;
  role: "support" | "owner";
  disabled: boolean;
  lastSignInAt?: string | null;
  createdBy?: string | null;
  activeSessions: number;
};

type Activity = {
  id: number;
  actorEmail: string;
  action: string;
  shopDomain?: string | null;
  targetId?: string | null;
  createdAt: string;
};

const NOTICES: Record<string, string> = {
  added: "Team member added. They can sign in now.",
  updated: "Team member updated.",
  signed_out: "Signed out on every device.",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const member = await requireConsoleMember(request, { role: "owner" });
  const res = await consoleApiFetch(member, "/team");
  const done = new URL(request.url).searchParams.get("done") || "";
  return {
    me: member.email,
    members: (res.data?.members || []) as Member[],
    activity: (res.data?.activity || []) as Activity[],
    error: res.ok ? null : supportErrorMessage(res.data, "Could not load the team"),
    notice: NOTICES[done] || null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  assertSameOrigin(request);
  const member = await requireConsoleMember(request, { role: "owner" });
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const id = Number(form.get("memberId"));

  let res;
  let done = "updated";
  if (intent === "add") {
    res = await consoleApiFetch(member, "/team", {
      method: "POST",
      body: {
        email: String(form.get("email") || ""),
        role: String(form.get("role") || "support"),
        displayName: String(form.get("displayName") || ""),
      },
      request,
    });
    done = "added";
  } else if (intent === "role") {
    res = await consoleApiFetch(member, `/team/${id}`, {
      method: "PATCH",
      body: { role: String(form.get("role") || "") },
      request,
    });
  } else if (intent === "disable" || intent === "enable") {
    res = await consoleApiFetch(member, `/team/${id}`, {
      method: "PATCH",
      body: { disabled: intent === "disable" },
      request,
    });
  } else if (intent === "sign-out") {
    res = await consoleApiFetch(member, `/team/${id}`, {
      method: "PATCH",
      body: { signOutEverywhere: true },
      request,
    });
    done = "signed_out";
  } else {
    return { error: "Choose an action." };
  }
  if (!res.ok) return { error: supportErrorMessage(res.data, "That did not work") };
  return redirect(`/console/team?done=${done}`);
};

export default function ConsoleTeam() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <section className="staff-panel">
      <div className="staff-panel-head">
        <p className="px-eyebrow">Console</p>
        <h1 className="staff-title">Team</h1>
        <p className="staff-lead">
          Only the people listed here can sign in. Support members handle tickets and see stores;
          owners can also give support access and manage the team.
        </p>
      </div>

      {actionData && "error" in actionData && actionData.error ? (
        <p className="staff-error" role="alert">
          {actionData.error}
        </p>
      ) : null}
      {data.error ? (
        <p className="staff-error" role="alert">
          {data.error}
        </p>
      ) : null}
      {data.notice ? (
        <p className="staff-success" aria-live="polite">
          {data.notice}
        </p>
      ) : null}

      <div className="px-card staff-panel-card">
        <h2 className="staff-section-title">Add a team member</h2>
        <Form method="post" className="staff-filters console-team-add">
          <input type="hidden" name="intent" value="add" />
          <label className="staff-label" htmlFor="member-email">
            Work email
            <input
              id="member-email"
              className="staff-input"
              name="email"
              type="email"
              required
              placeholder="name@echologyx.com"
              autoComplete="off"
            />
          </label>
          <label className="staff-label" htmlFor="member-name">
            Name (optional)
            <input id="member-name" className="staff-input" name="displayName" maxLength={80} />
          </label>
          <label className="staff-label" htmlFor="member-role">
            Role
            <select id="member-role" className="staff-input" name="role" defaultValue="support">
              <option value="support">Support</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <button className="px-btn px-btn--brand" type="submit" disabled={busy}>
            Add
          </button>
        </Form>
      </div>

      <div className="px-card staff-panel-card">
        <h2 className="staff-section-title">Members</h2>
        <div className="staff-table-wrap">
          <table className="staff-table console-table">
            <caption className="staff-visually-hidden">Team members</caption>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Last sign-in</th>
                <th>Signed in on</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => (
                <tr key={member.id} className={member.disabled ? "staff-row console-row--disabled" : "staff-row"}>
                  <td>
                    <span className="console-strong">{member.displayName || member.email}</span>
                    {member.displayName ? <span className="console-sub">{member.email}</span> : null}
                    {member.disabled ? <span className="console-tag">Disabled</span> : null}
                    {member.email === data.me ? <span className="console-tag">You</span> : null}
                  </td>
                  <td>
                    <Form method="post" className="console-inline-form">
                      <input type="hidden" name="intent" value="role" />
                      <input type="hidden" name="memberId" value={member.id} />
                      <select
                        className="staff-input"
                        name="role"
                        defaultValue={member.role}
                        key={`${member.id}:${member.role}`}
                        aria-label={`Role for ${member.email}`}
                        disabled={busy || member.disabled}
                        onChange={(event) => event.currentTarget.form?.requestSubmit()}
                      >
                        <option value="support">Support</option>
                        <option value="owner">Owner</option>
                      </select>
                    </Form>
                  </td>
                  <td>{formatConsoleDateTime(member.lastSignInAt)}</td>
                  <td className="console-num">
                    {member.activeSessions === 1 ? "1 device" : `${member.activeSessions} devices`}
                  </td>
                  <td>
                    <div className="console-row-actions">
                      {member.activeSessions > 0 ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="sign-out" />
                          <input type="hidden" name="memberId" value={member.id} />
                          <button className="staff-text-btn" type="submit" disabled={busy}>
                            Sign out everywhere
                          </button>
                        </Form>
                      ) : null}
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value={member.disabled ? "enable" : "disable"}
                        />
                        <input type="hidden" name="memberId" value={member.id} />
                        <button className="staff-text-btn" type="submit" disabled={busy}>
                          {member.disabled ? "Enable" : "Disable"}
                        </button>
                      </Form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="px-card staff-panel-card">
        <h2 className="staff-section-title">Recent console activity</h2>
        {data.activity.length ? (
          <ul className="console-list">
            {data.activity.map((item) => (
              <li key={item.id}>
                <span className="console-strong">{formatConsoleDateTime(item.createdAt)}</span> ·{" "}
                {item.actorEmail} · {consoleActionLabel(item.action)}
                {item.shopDomain ? ` · ${item.shopDomain}` : ""}
                {item.targetId && !item.shopDomain ? ` · ${item.targetId}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="staff-hint">No activity yet.</p>
        )}
      </div>
    </section>
  );
}
