// Seed function discovery from aligned pointers stored inside an overlay.
//@category ShinThemePark

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSetView;
import ghidra.program.model.mem.Memory;

public class SeedMipsFunctions extends GhidraScript {
    @Override
    protected void run() throws Exception {
        Memory memory = currentProgram.getMemory();
        AddressSetView loaded = memory.getLoadedAndInitializedAddressSet();
        Address start = loaded.getMinAddress();
        Address end = loaded.getMaxAddress();
        int seeded = 0;
        for (Address cursor = start; cursor.compareTo(end) <= 0 && !monitor.isCancelled(); cursor = cursor.add(4)) {
            if (cursor.add(3).compareTo(end) > 0) {
                break;
            }
            long value = Integer.toUnsignedLong(memory.getInt(cursor));
            if ((value & 3) != 0) {
                continue;
            }
            Address target = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(value);
            if (!loaded.contains(target) || currentProgram.getFunctionManager().getFunctionAt(target) != null) {
                continue;
            }
            if (disassemble(target) && getInstructionAt(target) != null) {
                createFunction(target, null);
                seeded++;
            }
        }
        println("seededFunctions=" + seeded);
    }
}
