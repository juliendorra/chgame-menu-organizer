/* SPDX-License-Identifier: GPL-3.0-or-later
 * Minimal LCD and controls for the CHSDtoSerial protocol.
 */
#include <CHGame.h>
#include "Display.h"

static uint8_t requested;
static bool priorB, holdingStart;
static uint32_t startPressed;

static void show(const char *status) {
    gfx_clear(0);
    gfx_text(10, 40, "SD MENU ORGANIZER", 1);
    gfx_text(10, 61, status, 2);
    gfx_text(10, 100, "HOLD START TO EXIT", 1);
    gfx_flush();
}

void display_begin() {
    chgame.boot();
    chgame.startExits = false;
    pinMode(PIN_LED, OUTPUT);
    digitalWrite(PIN_LED, LOW);
    gfx_begin(GFX_DIV2, GFX_12BPP);
    gfx_setPaletteEntry(0, 0x18C3);
    gfx_setPaletteEntry(1, 0xFFFF);
    gfx_setPaletteEntry(2, 0xDF6F);
}

void display_card(uint8_t error) { show(error ? "SD ERROR" : "CONNECT OVER USB"); }
void display_command(uint8_t, const uint8_t *, uint16_t) { digitalWrite(PIN_LED, HIGH); }
void display_link(uint8_t, uint8_t) {}

void display_result(uint8_t command, const uint8_t *, uint16_t, uint8_t error, const uint8_t *, uint16_t) {
    digitalWrite(PIN_LED, LOW);
    if (!error && command == 1) show("USB CONNECTED");
    if (!error && command == 10) show("RETURNING TO MENU");
}

void display_leaving() { delay(100); }
void display_cancelled(uint8_t action, uint8_t error) {
    show((action & 2) ? "RETURNING TO MENU" : error ? "SD ERROR" : "TRANSFER STOPPED");
}

uint8_t display_controls() {
    const uint8_t held = chgame_readButtons();
    const bool b = held & B_BUTTON;
    const bool start = held & START_BUTTON;
    if (b && !priorB) requested |= 1;
    if (start && !holdingStart) startPressed = millis();
    if (start && millis() - startPressed >= 3000) requested |= 2;
    priorB = b;
    holdingStart = start;
    return requested;
}

void display_controls_done() { requested = 0; }
extern "C" void transfer_ui_poll(void) { display_controls(); }
