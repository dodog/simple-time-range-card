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
    // Minimum allowed gap between start and end, in minutes. 
    this.minGapMinutes = Number.isFinite(config.min_gap_minutes)
      ? config.min_gap_minutes
      : 5;
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

  // Sets an entity's time to the given number of minutes-since-midnight via
  // input_datetime.set_datetime — the domain/service used by HA's date/time
  // helper. TO override it per-entity via config.entity_start_service / config.entity_end_service, e.g.
  //   entity_start_service: { domain: "some_domain", service: "some_service" }
  setEntityTime(entityId, minutes, overrideKey) {
    const override = this.config[overrideKey];
    const domain = override?.domain || "input_datetime";
    const service = override?.service || "set_datetime";

    this._hass.callService(domain, service, {
      entity_id: entityId,
      time: this.minutesToHHMM(minutes)
    });
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

        if (
          drag === "start" &&
          minutes <= dragEndMinutes - this.minGapMinutes &&
          minutes !== lastSentStart
        ) {
          dragStartMinutes = minutes;
          lastSentStart = minutes;
          this.setEntityTime(this.config.entity_start, minutes, "entity_start_service");
        }

        if (
          drag === "end" &&
          minutes >= dragStartMinutes + this.minGapMinutes &&
          minutes !== lastSentEnd
        ) {
          dragEndMinutes = minutes;
          lastSentEnd = minutes;
          this.setEntityTime(this.config.entity_end, minutes, "entity_end_service");
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
    this.startLabel.style.transform = "translateX(-50%)";
    this.endLabel.style.transform = "translateX(-50%)";
  }

  getCardSize() {
    return 3;
  }

  // Open visual"Edit card" UI (as opposed to the raw YAML editor)
  static getConfigElement() {
    return document.createElement("simple-time-range-card-editor");
  }

  // Default config used when the card is first added from the "+ Add Card"
  // picker, before the user has configured any entities.
  static getStubConfig() {
    return {
      entity_start: "",
      entity_end: "",
      bar_background: "#eee",
      bar_foreground: "#4caf50",
      min_gap_minutes: 5
    };
  }
}

customElements.define("simple-time-range-card", SimpleTimeRangeCard);

// -----------------------------------------------------------------------
// Visual config editor
// -----------------------------------------------------------------------
class SimpleTimeRangeCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    // Keep any already-rendered entity pickers in sync with the latest hass
    // object (they need it to resolve entity names/icons/states).
    if (this._entityPickers) {
      this._entityPickers.forEach((el) => {
        el.hass = hass;
      });
    }
  }

  connectedCallback() {
    this._render();
  }

  _updateConfig(key, value) {
    if (!this._config) return;

    if (value === "" || value === undefined || value === null) {
      const updated = { ...this._config };
      delete updated[key];
      this._config = updated;
    } else {
      this._config = { ...this._config, [key]: value };
    }

    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true
      })
    );
  }

  _fieldWrapper(labelText, inputEl, helpText) {
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px"
    });

    const label = document.createElement("label");
    label.textContent = labelText;
    Object.assign(label.style, {
      fontSize: "13px",
      fontWeight: "500",
      color: "var(--primary-text-color)"
    });

    wrapper.appendChild(label);
    wrapper.appendChild(inputEl);

    if (helpText) {
      const help = document.createElement("div");
      help.textContent = helpText;
      Object.assign(help.style, {
        fontSize: "12px",
        color: "var(--secondary-text-color)"
      });
      wrapper.appendChild(help);
    }

    return wrapper;
  }

  _makeTextInput(key, placeholder) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = this._config[key] || "";
    input.placeholder = placeholder || "";
    Object.assign(input.style, {
      padding: "8px 10px",
      borderRadius: "6px",
      border: "1px solid var(--divider-color, #ccc)",
      background: "var(--card-background-color)",
      color: "var(--primary-text-color)",
      font: "inherit"
    });
    input.addEventListener("change", () => {
      this._updateConfig(key, input.value.trim());
    });
    return input;
  }

  _makeNumberInput(key, defaultValue, min) {
    const input = document.createElement("input");
    input.type = "number";
    if (typeof min === "number") input.min = String(min);
    input.value = this._config[key] ?? defaultValue;
    Object.assign(input.style, {
      padding: "8px 10px",
      borderRadius: "6px",
      border: "1px solid var(--divider-color, #ccc)",
      background: "var(--card-background-color)",
      color: "var(--primary-text-color)",
      font: "inherit",
      width: "100px"
    });
    input.addEventListener("change", () => {
      const num = Number(input.value);
      this._updateConfig(key, Number.isFinite(num) ? num : undefined);
    });
    return input;
  }

  _makeEntityField(labelText, key, helpText) {
    if (customElements.get("ha-entity-picker")) {
      const picker = document.createElement("ha-entity-picker");
      picker.hass = this._hass;
      picker.label = labelText;
      picker.value = this._config[key] || "";
      picker.includeDomains = ["input_datetime"];
      picker.addEventListener("value-changed", (e) => {
        e.stopPropagation();
        this._updateConfig(key, e.detail.value);
      });
      this._entityPickers.push(picker);
      return picker;
    }

    // Fallback: plain text field if ha-entity-picker isn't available.
    return this._fieldWrapper(
      labelText,
      this._makeTextInput(key, "input_datetime.your_entity"),
      helpText
    );
  }

  _render() {
    if (!this._config) return;
    this.innerHTML = "";
    this._entityPickers = [];

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      padding: "8px 4px"
    });

    wrapper.appendChild(
      this._makeEntityField(
        "Start time entity",
        "entity_start",
        "An input_datetime helper with a time component."
      )
    );
    wrapper.appendChild(
      this._makeEntityField(
        "End time entity",
        "entity_end",
        "An input_datetime helper with a time component."
      )
    );

    wrapper.appendChild(
      this._fieldWrapper(
        "Bar background color",
        this._makeTextInput("bar_background", "#eee"),
        "Any CSS color value."
      )
    );
    wrapper.appendChild(
      this._fieldWrapper(
        "Bar foreground color",
        this._makeTextInput("bar_foreground", "#4caf50"),
        "Any CSS color value."
      )
    );
    wrapper.appendChild(
      this._fieldWrapper(
        "Minimum gap (minutes)",
        this._makeNumberInput("min_gap_minutes", 5, 0),
        "Smallest allowed distance between start and end."
      )
    );

    this.appendChild(wrapper);
  }
}

customElements.define("simple-time-range-card-editor", SimpleTimeRangeCardEditor);

// Registers the card in Lovelace's "+ Add Card" picker gallery.
window.customCards = window.customCards || [];
window.customCards.push({
  type: "simple-time-range-card",
  name: "Simple Time Range Card",
  description: "A draggable time-range slider backed by two input_datetime helpers.",
  preview: false
});
