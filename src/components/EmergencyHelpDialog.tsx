import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Phone, ShieldAlert, HeartPulse, Flame, AlertCircle, LifeBuoy } from "lucide-react";

export function EmergencyHelpDialog({ trigger }: { trigger?: React.ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const emergencyContacts = [
    {
      title: t("help.emergency_national_title", "National Emergency Service"),
      desc: t("help.emergency_national_desc", "Single unified emergency number for Police, Fire, and Medical."),
      number: "112",
      icon: ShieldAlert,
      color: "text-red-600 dark:text-red-400",
      badge: t("help.badge_all_emergency", "All Emergency"),
    },
    {
      title: t("help.ambulance_title", "Medical Emergency / Ambulance"),
      desc: t("help.ambulance_desc", "Government hill ambulance and urgent trauma care."),
      number: "108",
      altNumber: "102",
      icon: HeartPulse,
      color: "text-emerald-600 dark:text-emerald-400",
      badge: t("help.badge_24x7", "24x7 Toll-Free"),
    },
    {
      title: t("help.disaster_title", "Disaster Response (NDMA / SDMA)"),
      desc: t("help.disaster_desc", "State and National Disaster Management Authority."),
      number: "1070",
      altNumber: "1078",
      icon: AlertCircle,
      color: "text-amber-600 dark:text-amber-400",
      badge: t("help.badge_disaster", "Disaster Management"),
    },
    {
      title: t("help.fire_title", "Fire & Rescue Services"),
      desc: t("help.fire_desc", "Search, clearance, and flood/fire rescue operations."),
      number: "101",
      icon: Flame,
      color: "text-orange-600 dark:text-orange-400",
      badge: t("help.badge_rescue", "Rescue"),
    },
    {
      title: t("help.district_deoc_title", "District Emergency Operation Centre (DEOC)"),
      desc: t("help.district_deoc_desc", "District magistrate control room for local landslides."),
      number: "1077",
      icon: LifeBuoy,
      color: "text-primary",
      badge: t("help.badge_district", "District Level"),
    },
  ];

  const seocs = [
    { state: "Assam", phone: "1070" },
    { state: "Arunachal Pradesh", phone: "1070" },
    { state: "Manipur", phone: "1070" },
    { state: "Meghalaya", phone: "1070" },
    { state: "Mizoram", phone: "1070" },
    { state: "Nagaland", phone: "1070" },
    { state: "Sikkim", phone: "1070" },
    { state: "Tripura", phone: "1070" },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 rounded transition-colors"
          >
            {t("header.help", "Help")}
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto bg-surface text-foreground border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-display text-foreground flex items-center gap-2">
            <Phone className="h-5 w-5 text-red-600 dark:text-red-400" />
            <span>{t("help.dialog_title", "Official Emergency Helplines & Assistance")}</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t(
              "help.dialog_desc",
              "Verified Government of India and North Eastern State emergency contacts. Accessible toll-free 24/7.",
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Landslide Emergency Protocol Advisory */}
        <div className="rounded border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-3 text-xs space-y-1">
          <div className="font-bold text-red-900 dark:text-red-300 font-display flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{t("help.protocol_title", "Immediate Landslide Safety Advisory")}</span>
          </div>
          <p className="text-red-800 dark:text-red-300 text-[0.72rem] leading-relaxed">
            {t(
              "help.protocol_text",
              "If you observe ground cracks, sudden muddy runoff, or tilting trees, evacuate slope areas immediately. Do not attempt to cross blocked highways. Dial 112 or your district control room.",
            )}
          </p>
        </div>

        {/* Primary Contacts Grid */}
        <div className="space-y-2.5 pt-1">
          <h4 className="text-xs font-bold font-display uppercase tracking-wider text-muted-foreground">
            {t("help.key_helplines", "Key Emergency Contacts")}
          </h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {emergencyContacts.map((c) => {
              const Icon = c.icon;
              return (
                <div
                  key={c.number}
                  className="rounded border border-border bg-card p-3 flex flex-col justify-between gap-2 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${c.color}`} />
                      <div>
                        <div className="font-display font-bold text-xs text-foreground leading-tight">
                          {c.title}
                        </div>
                        <div className="text-[0.68rem] text-muted-foreground leading-snug mt-0.5">
                          {c.desc}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-border/60">
                    <span className="text-[0.65rem] font-mono text-muted-foreground">{c.badge}</span>
                    <div className="flex items-center gap-1.5">
                      <a
                        href={`tel:${c.number}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-primary-foreground font-mono font-bold text-xs hover:bg-primary/90 transition-colors"
                      >
                        <Phone className="h-3 w-3" />
                        <span>{c.number}</span>
                      </a>
                      {c.altNumber && (
                        <a
                          href={`tel:${c.altNumber}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border bg-secondary/50 font-mono text-xs text-foreground hover:bg-secondary transition-colors"
                        >
                          <span>{c.altNumber}</span>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* North Eastern State Emergency Operation Centres */}
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold font-display uppercase tracking-wider text-muted-foreground">
              {t("help.ner_seoc_title", "NER State Emergency Operation Centres (SEOC)")}
            </h4>
            <span className="text-[0.65rem] text-muted-foreground font-mono">
              {t("help.toll_free_code", "Toll-Free Code: 1070")}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {seocs.map((s) => (
              <a
                key={s.state}
                href={`tel:${s.phone}`}
                className="rounded border border-border bg-secondary/30 p-2 hover:bg-secondary/60 transition-colors flex flex-col items-center text-center"
              >
                <span className="text-xs font-medium text-foreground">{s.state}</span>
                <span className="text-[0.7rem] font-mono font-bold text-primary mt-0.5">
                  {s.phone}
                </span>
              </a>
            ))}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between pt-2 border-t border-border">
          <span className="text-[0.68rem] text-muted-foreground">
            {t("help.disclaimer", "Verified Government of India numbers")}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            className="text-xs"
          >
            {t("common.close", "Close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
