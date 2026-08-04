class SimpleTimeRangeCard extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  setConfig(config) {
    if (!config.entity_start || !config.entity_end) {
      throw new Error("Please define entity_start and entity_end");
    }
    this.config = config;
  }

  hhmmToMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  minutesToHHMM(minutes) {
    const h = Math.floor(minutes / 60).toString().padStart(2, "0");
    const m = (minutes % 60).toString().padStart(2, "0");
    return `${h}:${m}`;
  }

  getClientX(e) {
    if (e.touches && e.touches.length) return e.touches[0].clientX;
    return e.clientX;
  }

  render() {
    if (!this._hass) return;

    this.style.touchAction = "none";
    this.style.overscrollBehavior = "none";

    const startState = this._hass.states[this.config.entity_start]?.state;
    const endState = this._hass.states[this.config.entity_end]?.state;
    const timePattern = /^\d{2}:\d{2}/;
    if (!startState || !endState) return;
    if (!timePattern.test(startState) || !timePattern.test(endState)) return;

    const startTime = startState.slice(0, 5);
    const endTime = endState.slice(0, 5);

    const startMinutes = this.hhmmToMinutes(startTime);
    const endMinutes = this.hhmmToMinutes(endTime);

    if (!this.card) {
      this.innerHTML = "";

      this.card = document.createElement("div");
      this.card.style.padding = "6px 0";
      this.appendChild(this.card);

      this.bar = document.createElement("div");
      Object.assign(this.bar.style, {
        position: "relative",
        height: "100px",
        background: this.config.bar_background || "#eee",
        border: "1px solid #aaa",
        borderRadius: "10px",
        touchAction: "none",
        userSelect: "none"
      });
      this.card.appendChild(this.bar);

      this.range = document.createElement("div");
      Object.assign(this.range.style, {
        position: "absolute",
        height: "100%",
        background: this.config.bar_foreground || "#4caf50",
        borderRadius: "10px"
      });

      const makeHandle = () => {
        const h = document.createElement("div");
        Object.assign(h.style, {
          position: "absolute",
          top: "0",
          width: "18px",
          height: "100%",
          background: "#333",
          borderRadius: "6px",
          zIndex: "3"
        });

        const grip = document.createElement("div");
        Object.assign(grip.style, {
          position: "absolute",
          left: "50%",
          top: "20%",
          transform: "translateX(-50%)",
          width: "4px",
          height: "60%",
          background: "#fff",
          borderRadius: "2px"
        });

        h.appendChild(grip);
        return h;
      };

      const makeLabel = () => {
        const l = document.createElement("div");
        Object.assign(l.style, {

          position: "absolute",
          fontSize: "14px",
          fontWeight: "600",
          color: "var(--primary-text-color)",
          backgroundColor: "var(--card-background-color)",
          padding: "2px 6px",
          borderRadius: "6px",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          zIndex: "5",
          boxShadow: "0 1px 4px rgba(0,0,0,0.3)"


        });
        return l;
      };

      this.startHandle = makeHandle();
      this.endHandle = makeHandle();
      this.startLabel = makeLabel();
      this.endLabel = makeLabel();

      this.bar.append(
        this.range,
        this.startHandle,
        this.endHandle,
        this.startLabel,
        this.endLabel
      );

      let drag = null;
      let dragStartMinutes = null;
      let dragEndMinutes = null;
      // Last minute value is sent to callService
      let lastSentStart = null;
      let lastSentEnd = null;

      const move = (e) => {
        if (!drag) return;
        e.preventDefault();

        const rect = this.bar.getBoundingClientRect();
        let x = this.getClientX(e) - rect.left;
        x = Math.max(0, Math.min(x, rect.width));

        let minutes = Math.round((x / rect.width) * 1440 / 5) * 5;
        minutes = Math.min(minutes, 1439);

        if (drag === "start" && minutes < dragEndMinutes && minutes !== lastSentStart) {
          dragStartMinutes = minutes;
          lastSentStart = minutes;
          this._hass.callService("input_datetime", "set_datetime", {
            entity_id: this.config.entity_start,
            time: this.minutesToHHMM(minutes)
          });
        }

        if (drag === "end" && minutes > dragStartMinutes && minutes !== lastSentEnd) {
          dragEndMinutes = minutes;
          lastSentEnd = minutes;
          this._hass.callService("input_datetime", "set_datetime", {
            entity_id: this.config.entity_end,
            time: this.minutesToHHMM(minutes)
          });
        }
      };

      const stop = () => {
        drag = null;
        dragStartMinutes = null;
        dragEndMinutes = null;
        lastSentStart = null;
        lastSentEnd = null;
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", stop);
        window.removeEventListener("touchmove", move);
        window.removeEventListener("touchend", stop);
      };

      const start = (mode, e) => {
        e.preventDefault();
        drag = mode;

        // Seed the local drag state from the last known hass state so the
        // very first move event has something correct to compare against.
        dragStartMinutes = this.hhmmToMinutes(
          this._hass.states[this.config.entity_start].state.slice(0, 5)
        );
        dragEndMinutes = this.hhmmToMinutes(
          this._hass.states[this.config.entity_end].state.slice(0, 5)
        );
        lastSentStart = dragStartMinutes;
        lastSentEnd = dragEndMinutes;

        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", stop);
        window.addEventListener("touchmove", move, { passive: false });
        window.addEventListener("touchend", stop);
      };

      this.startHandle.addEventListener("mousedown", e => start("start", e));
      this.startHandle.addEventListener("touchstart", e => start("start", e), { passive: false });

      this.endHandle.addEventListener("mousedown", e => start("end", e));
      this.endHandle.addEventListener("touchstart", e => start("end", e), { passive: false });

      this.range.addEventListener("mousedown", e => {
        const r = this.range.getBoundingClientRect();
        start(e.clientX < r.left + r.width / 2 ? "start" : "end", e);
      });

      this.range.addEventListener("touchstart", e => {
        const r = this.range.getBoundingClientRect();
        start(this.getClientX(e) < r.left + r.width / 2 ? "start" : "end", e);
      }, { passive: false });
    }

    const startPct = (startMinutes / 1440) * 100;
    const endPct = (endMinutes / 1440) * 100;

    this.range.style.left = `${startPct}%`;
    this.range.style.width = `${endPct - startPct}%`;

    this.startHandle.style.left = `${startPct}%`;
    this.startHandle.style.transform = "translateX(-50%)";
    this.endHandle.style.left = `${endPct}%`;
    this.endHandle.style.transform = "translateX(-50%)";

    this.startLabel.textContent = startTime;
    this.endLabel.textContent = endTime;

    this.startLabel.style.left = `${startPct}%`;
    this.endLabel.style.left = `${endPct}%`;

    this.startLabel.style.top = "-30px";
    this.endLabel.style.top = "calc(100% + 4px)";
    this.startLabel.style.transform = "translateX(20px)";
    this.endLabel.style.transform = "translateX(-20px)";
  }

  getCardSize() {
    return 3;
  }
}

customElements.define("simple-time-range-card", SimpleTimeRangeCard);
