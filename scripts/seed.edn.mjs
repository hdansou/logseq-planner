// Seed for the live probe (T01): imported with logseq.api.import_edn (sqlite.build EDN), so the
// properties and tags are real user ones (`:user.property/*`, `:user.class/*`), not plugin-owned.
// Dates are relative to the day the seed runs. Closed values carry explicit uuids: without them
// sqlite.build cannot match a block's value to its choice and the import fails validation.

export const SEED_PAGE = "Planner probe";

const id = (n) => `6a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Fixed uuids, so fixtures and later tests can name nodes. */
export const U = {
  website: id(1), mobileApp: id(2), acme: id(3), archive: id(4),
  kickoff: id(11), lateReview: id(12), untimed: id(13),
  draftBrief: id(21), shipHome: id(22), survey: id(23), wireframes: id(24), contract: id(25), looseTask: id(26),
};

const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const journalDay = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const at = (d, h, m) => { const r = new Date(d); r.setHours(h, m, 0, 0); return r.getTime(); };

export function seedEdn(today) {
  const day = (n) => journalDay(addDays(today, n));
  const days = [-10, -3, 5, 20];
  const page = (n) => `[:build/page {:build/journal ${day(n)}}]`;
  const block = (n, title, tags, props = "") =>
    `{:block/uuid #uuid "${n}" :build/keep-uuid? true :block/title ${JSON.stringify(title)} :build/tags ${tags} :build/properties {${props}}}`;
  const ref = (u) => `[[${u}]]`;
  return `{:properties
 {:start {:block/title "Start" :logseq.property/type :date}
  :end {:block/title "End" :logseq.property/type :date}
  :owner {:block/title "Owner" :logseq.property/type :default
          :build/closed-values [{:value "Alice" :uuid #uuid "${id(101)}"} {:value "Bob" :uuid #uuid "${id(102)}"}]}
  :client {:block/title "Client" :logseq.property/type :default}
  :date {:block/title "Date" :logseq.property/type :datetime}
  :type {:block/title "Type" :logseq.property/type :default
         :build/closed-values [{:value "Planning" :uuid #uuid "${id(111)}"} {:value "Review" :uuid #uuid "${id(112)}"} {:value "1:1" :uuid #uuid "${id(113)}"}]}
  :project {:block/title "Project" :logseq.property/type :node}}
 :classes
 {:Project {:block/title "Project" :build/class-properties [:start :end :logseq.property/status :owner]}
  :ClientProject {:block/title "Client project" :build/class-extends [:Project] :build/class-properties [:client]}
  :Meeting {:block/title "Meeting" :build/class-properties [:date :type]}}
 :pages-and-blocks
 [${days.map((n) => `{:page {:build/journal ${day(n)}}}`).join("\n  ")}
  {:page {:block/title "${SEED_PAGE}"}
   :blocks
   [${[
     block(U.website, "Website relaunch", "[:Project]", `:start ${page(-10)} :end ${page(20)} :logseq.property/status :logseq.property/status.doing :owner "Alice"`),
     block(U.mobileApp, "Mobile app", "[:Project]", `:start ${page(5)} :logseq.property/status :logseq.property/status.todo :owner "Bob"`),
     block(U.acme, "Acme rollout", "[:ClientProject]", `:start ${page(-3)} :end ${page(5)} :logseq.property/status :logseq.property/status.in-review :owner "Alice" :client "Acme"`),
     block(U.archive, "Archive cleanup", "[:Project]", `:logseq.property/status :logseq.property/status.backlog`),
     block(U.kickoff, "Kickoff", "[:Meeting]", `:date ${at(today, 10, 30)} :type "Planning"`),
     block(U.lateReview, "Late review", "[:Meeting]", `:date ${at(addDays(today, 1), 23, 45)} :type "Review"`),
     block(U.untimed, "Untimed meeting", "[:Meeting]"),
     block(U.draftBrief, `Draft brief ${ref(U.website)}`, "[:logseq.class/Task]", `:logseq.property/status :logseq.property/status.todo :logseq.property/deadline ${at(addDays(today, 2), 17, 0)}`),
     block(U.shipHome, `Ship homepage ${ref(U.website)}`, "[:logseq.class/Task]", `:logseq.property/status :logseq.property/status.done`),
     block(U.survey, `Survey users ${ref(U.website)}`, "[:logseq.class/Task]", `:logseq.property/status :logseq.property/status.canceled`),
     block(U.wireframes, "Wireframes", "[:logseq.class/Task]", `:logseq.property/status :logseq.property/status.doing :logseq.property/scheduled ${at(addDays(today, 6), 9, 0)} :project [:block/uuid #uuid "${U.mobileApp}"]`),
     block(U.contract, "Acme contract", "[:logseq.class/Task]", `:logseq.property/status :logseq.property/status.todo :logseq.property/deadline ${at(addDays(today, -1), 12, 0)} :project [:block/uuid #uuid "${U.acme}"]`),
     block(U.looseTask, "Loose task", "[:logseq.class/Task]", `:logseq.property/status :logseq.property/status.todo`),
   ].join("\n    ")}]}]}`;
}
