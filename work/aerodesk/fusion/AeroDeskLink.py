"""Local Fusion add-in: export the active design for AeroDesk. No cloud credentials."""
import adsk.core, adsk.fusion, os, json, traceback, datetime
handlers = []
command_id = 'AeroDeskSendDesign'

class Send(adsk.core.CommandEventHandler):
    def notify(self, args):
        app = adsk.core.Application.get()
        try:
            design = adsk.fusion.Design.cast(app.activeProduct)
            if not design:
                app.userInterface.messageBox('Open a design in the Design workspace first.')
                return
            folder = os.path.join(os.environ['APPDATA'], 'AeroDesk', 'FusionInbox')
            os.makedirs(folder, exist_ok=True)
            temporary = os.path.join(folder, 'exporting.step')
            options = design.exportManager.createSTEPExportOptions(temporary)
            if not design.exportManager.execute(options):
                raise RuntimeError('Fusion could not export this design as STEP.')
            os.replace(temporary, os.path.join(folder, 'latest.step'))
            info = {'name': app.activeDocument.name, 'exportedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
            with open(os.path.join(folder, 'latest.json'), 'w', encoding='utf-8') as f:
                json.dump(info, f)
            app.userInterface.messageBox('Design sent to AeroDesk. In AeroDesk, choose Connect Autodesk Fusion, then Import latest design. STEP preserves assembly placement and units.')
        except Exception:
            app.userInterface.messageBox('AeroDesk export failed:\n' + traceback.format_exc())

class Created(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        handler = Send()
        args.command.execute.add(handler)
        handlers.append(handler)

def run(context):
    app = adsk.core.Application.get()
    ui = app.userInterface
    definition = ui.commandDefinitions.itemById(command_id)
    if not definition:
        definition = ui.commandDefinitions.addButtonDefinition(command_id, 'Send to AeroDesk', 'Export the active design to AeroDesk on this PC')
    handler = Created()
    definition.commandCreated.add(handler)
    handlers.append(handler)
    panel = ui.allToolbarPanels.itemById('SolidScriptsAddinsPanel')
    if panel and not panel.controls.itemById(command_id):
        panel.controls.addCommand(definition)

def stop(context):
    ui = adsk.core.Application.get().userInterface
    panel = ui.allToolbarPanels.itemById('SolidScriptsAddinsPanel')
    if panel:
        control = panel.controls.itemById(command_id)
        if control: control.deleteMe()
    definition = ui.commandDefinitions.itemById(command_id)
    if definition: definition.deleteMe()
    handlers.clear()
