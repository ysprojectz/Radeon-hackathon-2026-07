import { buildFollowUpSuggestions } from "@/lib/chat-suggestions";

describe("buildFollowUpSuggestions", () => {
  it("varies suggestions by user query intent even when response wording is similar", () => {
    const denial = buildFollowUpSuggestions({
      prompt: "Why are denied claims increasing this week?",
      content: "5 claims need attention.",
      pathname: "/claims",
    });
    const payout = buildFollowUpSuggestions({
      prompt: "Which accounts have payment gateway sync pending?",
      content: "5 claims need attention.",
      pathname: "/claims",
    });

    expect(denial).toContain("Show denial breakdown");
    expect(payout).toContain("Check gateway sync");
    expect(denial.slice(0, 4)).not.toEqual(payout.slice(0, 4));
  });

  it("avoids immediately repeating the previous suggestion set when alternatives exist", () => {
    const first = buildFollowUpSuggestions({
      prompt: "Show pending HITL queue",
      content: "Pending manual review queue.",
      pathname: "/hitl",
    });
    const second = buildFollowUpSuggestions({
      prompt: "Show pending HITL queue",
      content: "Pending manual review queue.",
      pathname: "/hitl",
      previous: first,
    });

    expect(second).toContain("✏ Write my own");
    expect(second.slice(0, 4)).not.toEqual(first.slice(0, 4));
  });
});
