package tray

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"runtime"
)

// getIcon returns the embedded icon bytes for the system tray.
func getIcon() []byte {
	if runtime.GOOS == "windows" {
		return generateICO()
	}
	return generatePNG()
}

// kamvdiIcon creates a 32x32 RGBA image with a "K" shape in blue/white.
func kamvdiIcon() *image.RGBA {
	const size = 32
	img := image.NewRGBA(image.Rect(0, 0, size, size))

	bg := color.RGBA{R: 37, G: 99, B: 235, A: 255}   // blue
	fg := color.RGBA{R: 255, G: 255, B: 255, A: 255}  // white

	// Fill background
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			img.SetRGBA(x, y, bg)
		}
	}

	// Draw a "K" letter (pixel art style, 8-24 x range, 6-26 y range)
	for y := 6; y < 26; y++ {
		// Left vertical bar of K
		for x := 9; x < 13; x++ {
			img.SetRGBA(x, y, fg)
		}
	}
	// Diagonals of K
	for i := 0; i < 10; i++ {
		// Upper diagonal going right-up from middle
		y := 15 - i
		x := 13 + i
		if x < 24 && y >= 6 {
			for dx := 0; dx < 3; dx++ {
				img.SetRGBA(x+dx, y, fg)
				img.SetRGBA(x+dx, y+1, fg)
			}
		}
		// Lower diagonal going right-down from middle
		y = 16 + i
		if x < 24 && y < 26 {
			for dx := 0; dx < 3; dx++ {
				img.SetRGBA(x+dx, y, fg)
				img.SetRGBA(x+dx, y-1, fg)
			}
		}
	}

	return img
}

// generatePNG creates a valid PNG from the icon image.
func generatePNG() []byte {
	img := kamvdiIcon()
	return encodePNG(img)
}

// generateICO wraps a PNG in ICO format for Windows.
func generateICO() []byte {
	png := generatePNG()

	var buf bytes.Buffer
	// ICO header: reserved(2) + type=1(2) + count=1(2)
	binary.Write(&buf, binary.LittleEndian, uint16(0))
	binary.Write(&buf, binary.LittleEndian, uint16(1))
	binary.Write(&buf, binary.LittleEndian, uint16(1))
	// ICO directory entry
	buf.WriteByte(32)                                              // width
	buf.WriteByte(32)                                              // height
	buf.WriteByte(0)                                               // color palette
	buf.WriteByte(0)                                               // reserved
	binary.Write(&buf, binary.LittleEndian, uint16(1))             // color planes
	binary.Write(&buf, binary.LittleEndian, uint16(32))            // bits per pixel
	binary.Write(&buf, binary.LittleEndian, uint32(len(png)))      // size of PNG data
	binary.Write(&buf, binary.LittleEndian, uint32(6+16))          // offset to PNG data (header=6 + entry=16)
	// PNG data
	buf.Write(png)

	return buf.Bytes()
}

// encodePNG is a minimal PNG encoder for RGBA images.
func encodePNG(img *image.RGBA) []byte {
	w := img.Bounds().Dx()
	h := img.Bounds().Dy()

	var buf bytes.Buffer

	// PNG signature
	buf.Write([]byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a})

	// IHDR
	var ihdr bytes.Buffer
	binary.Write(&ihdr, binary.BigEndian, uint32(w))
	binary.Write(&ihdr, binary.BigEndian, uint32(h))
	ihdr.WriteByte(8) // bit depth
	ihdr.WriteByte(6) // color type RGBA
	ihdr.WriteByte(0) // compression
	ihdr.WriteByte(0) // filter
	ihdr.WriteByte(0) // interlace
	writeChunk(&buf, "IHDR", ihdr.Bytes())

	// IDAT - raw pixel data with filter byte per row
	var raw bytes.Buffer
	for y := 0; y < h; y++ {
		raw.WriteByte(0) // filter: none
		for x := 0; x < w; x++ {
			c := img.RGBAAt(x, y)
			raw.Write([]byte{c.R, c.G, c.B, c.A})
		}
	}
	var compressed bytes.Buffer
	zw, _ := zlib.NewWriterLevel(&compressed, zlib.BestCompression)
	zw.Write(raw.Bytes())
	zw.Close()
	writeChunk(&buf, "IDAT", compressed.Bytes())

	// IEND
	writeChunk(&buf, "IEND", nil)

	return buf.Bytes()
}

func writeChunk(buf *bytes.Buffer, chunkType string, data []byte) {
	binary.Write(buf, binary.BigEndian, uint32(len(data)))
	buf.WriteString(chunkType)
	if len(data) > 0 {
		buf.Write(data)
	}
	crc := crc32.NewIEEE()
	crc.Write([]byte(chunkType))
	if len(data) > 0 {
		crc.Write(data)
	}
	binary.Write(buf, binary.BigEndian, crc.Sum32())
}
