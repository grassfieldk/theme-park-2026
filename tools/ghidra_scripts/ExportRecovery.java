// Export functions, decompiler output, and strings from an analyzed program.
//@category ShinThemePark

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

public class ExportRecovery extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1 || args.length > 2) {
            throw new IllegalArgumentException("output directory and optional per-program flag are required");
        }
        File output = new File(args[0]);
        if (args.length == 2 && args[1].equals("per-program")) {
            output = new File(output, currentProgram.getName().replaceAll("[^A-Za-z0-9._-]", "_"));
        }
        output.mkdirs();

        DecompInterface decompiler = new DecompInterface();
        decompiler.openProgram(currentProgram);
        int functionCount = 0;
        int decompiledCount = 0;
        try (BufferedWriter functions = new BufferedWriter(new FileWriter(new File(output, "functions.tsv")));
             BufferedWriter source = new BufferedWriter(new FileWriter(new File(output, "decompiled.c")))) {
            functions.write("address\tname\tsize\tdecompiled\n");
            FunctionIterator iterator = currentProgram.getFunctionManager().getFunctions(true);
            while (iterator.hasNext() && !monitor.isCancelled()) {
                Function function = iterator.next();
                DecompileResults result = decompiler.decompileFunction(function, 60, monitor);
                boolean success = result.decompileCompleted();
                functions.write(function.getEntryPoint() + "\t" + function.getName() + "\t"
                    + function.getBody().getNumAddresses() + "\t" + success + "\n");
                functionCount++;
                if (success) {
                    source.write("/* " + function.getEntryPoint() + " " + function.getName() + " */\n");
                    source.write(result.getDecompiledFunction().getC());
                    source.write("\n\n");
                    decompiledCount++;
                }
            }
        } finally {
            decompiler.dispose();
        }

        int stringCount = 0;
        try (BufferedWriter strings = new BufferedWriter(new FileWriter(new File(output, "strings.tsv")))) {
            strings.write("address\tvalue\n");
            var iterator = currentProgram.getListing().getDefinedData(true);
            while (iterator.hasNext()) {
                Data data = iterator.next();
                Object value = data.getValue();
                if (value instanceof String) {
                    String text = (String) value;
                    strings.write(data.getAddress() + "\t" + text.replace("\t", "\\t").replace("\n", "\\n") + "\n");
                    stringCount++;
                }
            }
        }
        try (BufferedWriter assembly = new BufferedWriter(new FileWriter(new File(output, "assembly.tsv")))) {
            assembly.write("address\tinstruction\n");
            var iterator = currentProgram.getListing().getInstructions(true);
            while (iterator.hasNext()) {
                Instruction instruction = iterator.next();
                assembly.write(instruction.getAddress() + "\t" + instruction.toString().replace("\t", " ") + "\n");
            }
        }
        try (BufferedWriter references = new BufferedWriter(new FileWriter(new File(output, "references.tsv")))) {
            references.write("from\tto\ttype\tfunction\n");
            ReferenceIterator iterator = currentProgram.getReferenceManager().getReferenceIterator(currentProgram.getMinAddress());
            while (iterator.hasNext()) {
                Reference reference = iterator.next();
                Function function = currentProgram.getFunctionManager().getFunctionContaining(reference.getFromAddress());
                references.write(reference.getFromAddress() + "\t" + reference.getToAddress() + "\t"
                    + reference.getReferenceType() + "\t" + (function == null ? "" : function.getName()) + "\n");
            }
        }
        println("functions=" + functionCount + " decompiled=" + decompiledCount + " strings=" + stringCount);
    }
}
