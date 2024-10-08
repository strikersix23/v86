"use strict";

/**
 * Adapter to use visual screen in browsers (in contrast to node)
 * @constructor
 * @param {Object} options
 */
function ScreenAdapter(options, screen_fill_buffer)
{
    const screen_container = options.container;
    this.screen_fill_buffer = screen_fill_buffer;

    console.assert(screen_container, "options.container must be provided");

    var
        graphic_screen = screen_container.getElementsByTagName("canvas")[0],
        graphic_context = graphic_screen.getContext("2d", { alpha: false }),

        text_screen = screen_container.getElementsByTagName("div")[0],
        cursor_element = document.createElement("div");

    var
        /** @type {number} */
        cursor_row,

        /** @type {number} */
        cursor_col,

        /** @type {number} */
        scale_x = 1,

        /** @type {number} */
        scale_y = 1,

        base_scale = 1,

        changed_rows,

        // are we in graphical mode now?
        is_graphical = !!options.use_graphical_text,

        // Index 0: ASCII code
        // Index 1: Blinking
        // Index 2: Background color
        // Index 3: Foreground color
        text_mode_data,

        // number of columns
        text_mode_width,

        // number of rows
        text_mode_height;

    const CHARACTER_INDEX = 0;
    const BLINKING_INDEX = 1;
    const BG_COLOR_INDEX = 2;
    const FG_COLOR_INDEX = 3;
    const TEXT_MODE_COMPONENT_SIZE = 4;

    var stopped = false;
    var paused = false;

    // 0x12345 -> "#012345"
    function number_as_color(n)
    {
        n = n.toString(16);
        return "#" + "0".repeat(6 - n.length) + n;
    }


    /**
     * Charmaps that constraint unicode sequences for the default dospage
     * @const
     */
    var charmap_high = new Uint16Array([
        0x2302,
        0xC7, 0xFC, 0xE9, 0xE2, 0xE4, 0xE0, 0xE5, 0xE7,
        0xEA, 0xEB, 0xE8, 0xEF, 0xEE, 0xEC, 0xC4, 0xC5,
        0xC9, 0xE6, 0xC6, 0xF4, 0xF6, 0xF2, 0xFB, 0xF9,
        0xFF, 0xD6, 0xDC, 0xA2, 0xA3, 0xA5, 0x20A7, 0x192,
        0xE1, 0xED, 0xF3, 0xFA, 0xF1, 0xD1, 0xAA, 0xBA,
        0xBF, 0x2310, 0xAC, 0xBD, 0xBC, 0xA1, 0xAB, 0xBB,
        0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556,
        0x2555, 0x2563, 0x2551, 0x2557, 0x255D, 0x255C, 0x255B, 0x2510,
        0x2514, 0x2534, 0x252C, 0x251C, 0x2500, 0x253C, 0x255E, 0x255F,
        0x255A, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256C, 0x2567,
        0x2568, 0x2564, 0x2565, 0x2559, 0x2558, 0x2552, 0x2553, 0x256B,
        0x256A, 0x2518, 0x250C, 0x2588, 0x2584, 0x258C, 0x2590, 0x2580,
        0x3B1, 0xDF, 0x393, 0x3C0, 0x3A3, 0x3C3, 0xB5, 0x3C4,
        0x3A6, 0x398, 0x3A9, 0x3B4, 0x221E, 0x3C6, 0x3B5, 0x2229,
        0x2261, 0xB1, 0x2265, 0x2264, 0x2320, 0x2321, 0xF7,
        0x2248, 0xB0, 0x2219, 0xB7, 0x221A, 0x207F, 0xB2, 0x25A0, 0xA0
    ]);

    /** @const */
    var charmap_low = new Uint16Array([
        0x20,   0x263A, 0x263B, 0x2665, 0x2666, 0x2663, 0x2660, 0x2022,
        0x25D8, 0x25CB, 0x25D9, 0x2642, 0x2640, 0x266A, 0x266B, 0x263C,
        0x25BA, 0x25C4, 0x2195, 0x203C, 0xB6,   0xA7,   0x25AC, 0x21A8,
        0x2191, 0x2193, 0x2192, 0x2190, 0x221F, 0x2194, 0x25B2, 0x25BC
    ]);

    var charmap = [],
        chr;

    for(var i = 0; i < 256; i++)
    {
        if(i > 126)
        {
            chr = charmap_high[i - 0x7F];
        }
        else if(i < 32)
        {
            chr = charmap_low[i];
        }
        else
        {
            chr = i;
        }

        charmap[i] = String.fromCharCode(chr);
    }

    graphic_context.imageSmoothingEnabled = false;

    cursor_element.classList.add("cursor");
    cursor_element.style.position = "absolute";
    cursor_element.style.backgroundColor = "#ccc";
    cursor_element.style.width = "7px";
    cursor_element.style.display = "inline-block";

    text_screen.style.display = "block";
    graphic_screen.style.display = "none";

    this.init = function()
    {
        // initialize with mode and size presets as expected by the bios
        // to avoid flickering during early startup
        this.set_mode(is_graphical);

        if(is_graphical)
        {
            // assume 80x25 with 9x16 font
            this.set_size_graphical(720, 400, 720, 400);
        }
        else
        {
            this.set_size_text(80, 25);
        }

        this.timer();
    };

    this.make_screenshot = function()
    {
        const image = new Image();

        if(is_graphical)
        {
            image.src = graphic_screen.toDataURL("image/png");
        }
        else
        {
            // Default 720x400, but can be [8, 16] at 640x400
            const char_size = [9, 16];

            const canvas = document.createElement("canvas");
            canvas.width = text_mode_width * char_size[0];
            canvas.height = text_mode_height * char_size[1];
            const context = canvas.getContext("2d");
            context.imageSmoothingEnabled = false;
            context.font = window.getComputedStyle(text_screen).font;
            context.textBaseline = "top";

            for(let y = 0; y < text_mode_height; y++)
            {
                for(let x = 0; x < text_mode_width; x++)
                {
                    const index = (y * text_mode_width + x) * TEXT_MODE_COMPONENT_SIZE;
                    const character = text_mode_data[index + CHARACTER_INDEX];
                    const bg_color = text_mode_data[index + BG_COLOR_INDEX];
                    const fg_color = text_mode_data[index + FG_COLOR_INDEX];

                    context.fillStyle = number_as_color(bg_color);
                    context.fillRect(x * char_size[0], y * char_size[1], char_size[0], char_size[1]);
                    context.fillStyle = number_as_color(fg_color);
                    context.fillText(charmap[character], x * char_size[0], y * char_size[1]);
                }
            }

            if(cursor_element.style.display !== "none" && cursor_row < text_mode_height && cursor_col < text_mode_width)
            {
                context.fillStyle = cursor_element.style.backgroundColor;
                context.fillRect(
                    cursor_col * char_size[0],
                    cursor_row * char_size[1] + parseInt(cursor_element.style.marginTop, 10),
                    parseInt(cursor_element.style.width, 10),
                    parseInt(cursor_element.style.height, 10)
                );
            }

            image.src = canvas.toDataURL("image/png");
        }
        return image;
    };

    this.put_char = function(row, col, chr, blinking, bg_color, fg_color)
    {
        dbg_assert(row >= 0 && row < text_mode_height);
        dbg_assert(col >= 0 && col < text_mode_width);
        dbg_assert(chr >= 0 && chr < 0x100);

        const p = TEXT_MODE_COMPONENT_SIZE * (row * text_mode_width + col);

        text_mode_data[p + CHARACTER_INDEX] = chr;
        text_mode_data[p + BLINKING_INDEX] = blinking;
        text_mode_data[p + BG_COLOR_INDEX] = bg_color;
        text_mode_data[p + FG_COLOR_INDEX] = fg_color;

        changed_rows[row] = 1;
    };

    this.timer = function()
    {
        if(!stopped)
        {
            requestAnimationFrame(() => is_graphical ? this.update_graphical() : this.update_text());
        }
    };

    this.update_text = function()
    {
        for(var i = 0; i < text_mode_height; i++)
        {
            if(changed_rows[i])
            {
                this.text_update_row(i);
                changed_rows[i] = 0;
            }
        }

        this.timer();
    };

    this.update_graphical = function()
    {
        if(!paused)
        {
            this.screen_fill_buffer();
        }
        this.timer();
    };

    this.destroy = function()
    {
        stopped = true;
    };

    this.pause = function()
    {
        paused = true;
        cursor_element.classList.remove("blinking-cursor");
    };
    this.continue = function()
    {
        paused = false;
        cursor_element.classList.add("blinking-cursor");
    };

    this.set_mode = function(graphical)
    {
        is_graphical = graphical;

        if(graphical)
        {
            text_screen.style.display = "none";
            graphic_screen.style.display = "block";
        }
        else
        {
            text_screen.style.display = "block";
            graphic_screen.style.display = "none";
        }
    };

    this.clear_screen = function()
    {
        graphic_context.fillStyle = "#000";
        graphic_context.fillRect(0, 0, graphic_screen.width, graphic_screen.height);
    };

    /**
     * @param {number} cols
     * @param {number} rows
     */
    this.set_size_text = function(cols, rows)
    {
        if(cols === text_mode_width && rows === text_mode_height)
        {
            return;
        }

        changed_rows = new Int8Array(rows);
        text_mode_data = new Int32Array(cols * rows * TEXT_MODE_COMPONENT_SIZE);

        text_mode_width = cols;
        text_mode_height = rows;

        while(text_screen.childNodes.length > rows)
        {
            text_screen.removeChild(text_screen.firstChild);
        }

        while(text_screen.childNodes.length < rows)
        {
            text_screen.appendChild(document.createElement("div"));
        }

        for(var i = 0; i < rows; i++)
        {
            this.text_update_row(i);
        }

        update_scale_text();
    };

    this.set_size_graphical = function(width, height, buffer_width, buffer_height)
    {
        if(DEBUG_SCREEN_LAYERS)
        {
            // Draw the entire buffer. Useful for debugging
            // panning / page flipping / screen splitting code for both
            // v86 developers and os developers
            width = buffer_width;
            height = buffer_height;
        }

        graphic_screen.style.display = "block";

        graphic_screen.width = width;
        graphic_screen.height = height;
        // graphic_context loses its configuration when its graphic_screen gets resized, reinitialize
        graphic_context.imageSmoothingEnabled = false;

        // add some scaling to tiny resolutions
        if(!options.disable_autoscale &&
            width <= 640 &&
            width * 2 < window.innerWidth * window.devicePixelRatio &&
            height * 2 < window.innerHeight * window.devicePixelRatio)
        {
            base_scale = 2;
        }
        else
        {
            base_scale = 1;
        }

        update_scale_graphic();
    };

    this.set_scale = function(s_x, s_y)
    {
        scale_x = s_x;
        scale_y = s_y;

        update_scale_text();
        update_scale_graphic();
    };
    this.set_scale(scale_x, scale_y);

    function update_scale_text()
    {
        elem_set_scale(text_screen, scale_x, scale_y, true);
    }

    function update_scale_graphic()
    {
        elem_set_scale(graphic_screen, scale_x * base_scale, scale_y * base_scale, false);
    }

    function elem_set_scale(elem, scale_x, scale_y, use_scale)
    {
        elem.style.width = "";
        elem.style.height = "";

        if(use_scale)
        {
            elem.style.transform = "";
        }

        var rectangle = elem.getBoundingClientRect();

        if(use_scale)
        {
            var scale_str = "";

            scale_str += scale_x === 1 ? "" : " scaleX(" + scale_x + ")";
            scale_str += scale_y === 1 ? "" : " scaleY(" + scale_y + ")";

            elem.style.transform = scale_str;
        }
        else
        {
            // unblur non-fractional scales
            if(scale_x % 1 === 0 && scale_y % 1 === 0)
            {
                graphic_screen.style["imageRendering"] = "crisp-edges"; // firefox
                graphic_screen.style["imageRendering"] = "pixelated";
                graphic_screen.style["-ms-interpolation-mode"] = "nearest-neighbor";
            }
            else
            {
                graphic_screen.style["imageRendering"] = "";
                graphic_screen.style["-ms-interpolation-mode"] = "";
            }

            // undo fractional css-to-device pixel ratios
            var device_pixel_ratio = window.devicePixelRatio || 1;
            if(device_pixel_ratio % 1 !== 0)
            {
                scale_x /= device_pixel_ratio;
                scale_y /= device_pixel_ratio;
            }
        }

        if(scale_x !== 1)
        {
            elem.style.width = rectangle.width * scale_x + "px";
        }
        if(scale_y !== 1)
        {
            elem.style.height = rectangle.height * scale_y + "px";
        }
    }

    this.update_cursor_scanline = function(start, end, visible)
    {
        if(visible)
        {
            cursor_element.style.display = "inline";
            cursor_element.style.height = (end - start) + "px";
            cursor_element.style.marginTop = start + "px";
        }
        else
        {
            cursor_element.style.display = "none";
        }
    };

    this.update_cursor = function(row, col)
    {
        if(row !== cursor_row || col !== cursor_col)
        {
            if(row < text_mode_height)
            {
                changed_rows[row] = 1;
            }
            if(cursor_row < text_mode_height)
            {
                changed_rows[cursor_row] = 1;
            }

            cursor_row = row;
            cursor_col = col;
        }
    };

    this.text_update_row = function(row)
    {
        var offset = TEXT_MODE_COMPONENT_SIZE * row * text_mode_width,
            row_element,
            color_element,
            fragment;

        var blinking,
            bg_color,
            fg_color,
            text;

        row_element = text_screen.childNodes[row];
        fragment = document.createElement("div");

        for(var i = 0; i < text_mode_width; )
        {
            color_element = document.createElement("span");

            blinking = text_mode_data[offset + BLINKING_INDEX];
            bg_color = text_mode_data[offset + BG_COLOR_INDEX];
            fg_color = text_mode_data[offset + FG_COLOR_INDEX];

            if(blinking)
            {
                color_element.classList.add("blink");
            }

            color_element.style.backgroundColor = number_as_color(bg_color);
            color_element.style.color = number_as_color(fg_color);

            text = "";

            // put characters of the same color in one element
            while(i < text_mode_width &&
                text_mode_data[offset + BLINKING_INDEX] === blinking &&
                text_mode_data[offset + BG_COLOR_INDEX] === bg_color &&
                text_mode_data[offset + FG_COLOR_INDEX] === fg_color)
            {
                var ascii = text_mode_data[offset + CHARACTER_INDEX];

                text += charmap[ascii];
                dbg_assert(charmap[ascii]);

                i++;
                offset += TEXT_MODE_COMPONENT_SIZE;

                if(row === cursor_row)
                {
                    if(i === cursor_col)
                    {
                        // next row will be cursor
                        // create new element
                        break;
                    }
                    else if(i === cursor_col + 1)
                    {
                        // found the cursor
                        cursor_element.style.backgroundColor = color_element.style.color;
                        fragment.appendChild(cursor_element);
                        break;
                    }
                }
            }

            color_element.textContent = text;
            fragment.appendChild(color_element);
        }

        row_element.parentNode.replaceChild(fragment, row_element);
    };

    this.update_buffer = function(layers)
    {
        if(DEBUG_SCREEN_LAYERS)
        {
            // For each visible layer that would've been drawn, draw a
            // rectangle to visualise the layer instead.
            graphic_context.strokeStyle = "#0F0";
            graphic_context.lineWidth = 4;
            for(const layer of layers)
            {
                graphic_context.strokeRect(
                    layer.buffer_x,
                    layer.buffer_y,
                    layer.buffer_width,
                    layer.buffer_height
                );
            }
            graphic_context.lineWidth = 1;
            return;
        }

        for(const layer of layers)
        {
            graphic_context.putImageData(
                layer.image_data,
                layer.screen_x - layer.buffer_x,
                layer.screen_y - layer.buffer_y,
                layer.buffer_x,
                layer.buffer_y,
                layer.buffer_width,
                layer.buffer_height
            );
        }
    };

    // XXX: duplicated in DummyScreenAdapter
    this.get_text_screen = function()
    {
        var screen = [];

        for(var i = 0; i < text_mode_height; i++)
        {
            screen.push(this.get_text_row(i));
        }

        return screen;
    };

    this.get_text_row = function(y)
    {
        let result = "";

        for(let x = 0; x < text_mode_width; x++)
        {
            const index = (y * text_mode_width + x) * TEXT_MODE_COMPONENT_SIZE;
            const character = text_mode_data[index + CHARACTER_INDEX];
            result += String.fromCharCode(character);
        }

        return result;
    };

    this.init();
}
